import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = path.join(ROOT, "src");

const INTERNAL_ALLOWED = {
  domain: ["@/domain/", "@/shared/"],
  application: ["@/application/", "@/domain/", "@/shared/"],
  http: ["@/application/", "@/composition/", "@/config/", "@/domain/", "@/http/", "@/shared/"],
  infrastructure: ["@/config/", "@/domain/", "@/infrastructure/", "@/shared/"],
  composition: ["@/application/", "@/composition/", "@/config/", "@/domain/", "@/infrastructure/", "@/shared/"],
  shared: ["@/shared/"],
};

const EXTERNAL_BANNED = {
  domain: [/^@hono\//, /^hono$/, /^drizzle-orm(\/|$)/, /^cloudflare:/, /^@cloudflare\//],
  application: [/^@hono\//, /^hono$/, /^drizzle-orm(\/|$)/, /^cloudflare:/, /^@cloudflare\//],
  http: [/^drizzle-orm(\/|$)/],
  infrastructure: [/^@hono\//, /^hono$/],
};

const STORAGE_ERROR_PATTERNS = [
  /UNIQUE constraint failed/i,
  /\bSQLite\b/i,
  /\bD1\b/i,
  /\bDrizzle\b/i,
];

const ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const DISALLOWED_REQ_METHODS = new Set(["json", "text", "formData", "parseBody", "query", "queries", "param", "header"]);
const ALLOWED_VALID_KINDS = new Set(["param", "query", "json", "header"]);

const sourceFiles = new Map();
const violations = [];

main();

function main() {
  for (const filePath of walkTsFiles(SRC_DIR)) {
    sourceFiles.set(filePath, createSourceFile(filePath));
  }

  for (const [filePath, sourceFile] of sourceFiles) {
    runFileRules(filePath, sourceFile);
  }

  if (violations.length === 0) {
    process.stdout.write("Architecture lint passed.\n");
    return;
  }

  for (const violation of violations.sort(compareViolations)) {
    process.stderr.write(`${violation.file}:${violation.line}:${violation.column} ${violation.message}\n`);
  }

  process.stderr.write(`\nArchitecture lint failed with ${violations.length} violation(s).\n`);
  process.exit(1);
}

function runFileRules(filePath, sourceFile) {
  const relativePath = toRepoPath(filePath);
  const layer = getLayer(relativePath);

  checkInternalImports(relativePath, sourceFile, layer);
  checkExternalImports(relativePath, sourceFile, layer);
  checkNoMapperImportsOutsideInfrastructure(relativePath, sourceFile);
  checkStorageErrorParsing(relativePath, sourceFile);
  checkCustomErrors(relativePath, sourceFile);
  checkReqValidUsage(relativePath, sourceFile);

  if (relativePath.startsWith("src/http/schemas/") || relativePath.startsWith("src/shared/validation/") || relativePath.startsWith("src/shared/pagination/")) {
    checkNoPlainZodImport(relativePath, sourceFile);
  }

  if (isRouteModule(relativePath)) {
    checkRouteModule(relativePath, sourceFile);
  }

  if (isRepositoryOrWorkflow(relativePath)) {
    checkRepositoryOrWorkflow(relativePath, sourceFile);
  }

  if (isMapperFile(relativePath)) {
    checkMapperFile(filePath, relativePath, sourceFile);
  }

  if (relativePath === "src/infrastructure/persistence/crud-adapter.ts") {
    checkCrudAdapterJSDoc(relativePath, sourceFile);
  }
}

function checkInternalImports(relativePath, sourceFile, layer) {
  if (!layer) {
    return;
  }

  const allowedPrefixes = INTERNAL_ALLOWED[layer];
  if (!allowedPrefixes) {
    return;
  }

  for (const node of sourceFile.statements) {
    if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) {
      continue;
    }

    const specifier = getModuleSpecifier(node);
    if (!specifier?.startsWith("@/")) {
      continue;
    }

    if (!allowedPrefixes.some((prefix) => specifier.startsWith(prefix))) {
      addViolation(relativePath, node.moduleSpecifier, `Disallowed ${layer} import: ${specifier}`);
    }
  }
}

function checkExternalImports(relativePath, sourceFile, layer) {
  if (!layer || !EXTERNAL_BANNED[layer]) {
    return;
  }

  for (const importNode of getImportDeclarations(sourceFile)) {
    const specifier = importNode.moduleSpecifier.text;
    if (specifier.startsWith("@/")) {
      continue;
    }

    if (EXTERNAL_BANNED[layer].some((pattern) => pattern.test(specifier))) {
      addViolation(relativePath, importNode.moduleSpecifier, `Disallowed external import in ${layer} layer: ${specifier}`);
    }
  }
}

function checkNoMapperImportsOutsideInfrastructure(relativePath, sourceFile) {
  if (relativePath.startsWith("src/infrastructure/")) {
    return;
  }

  for (const importNode of getImportDeclarations(sourceFile)) {
    const specifier = importNode.moduleSpecifier.text;
    if (specifier.includes("/repositories/mappers/")) {
      addViolation(relativePath, importNode.moduleSpecifier, `Mapper imports are only allowed inside infrastructure: ${specifier}`);
    }
  }
}

function checkStorageErrorParsing(relativePath, sourceFile) {
  if (!/^(src\/application|src\/domain|src\/http|src\/shared)\//.test(relativePath)) {
    return;
  }

  if (relativePath === "src/shared/errors.ts") {
    return;
  }

  visit(sourceFile, (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (STORAGE_ERROR_PATTERNS.some((pattern) => pattern.test(node.text))) {
        addViolation(relativePath, node, `Storage-driver parsing terms must stay in infrastructure helpers: ${node.text}`);
      }
    }
  });
}

function checkCustomErrors(relativePath, sourceFile) {
  if (relativePath === "src/shared/errors.ts") {
    return;
  }

  visit(sourceFile, (node) => {
    if (!ts.isClassDeclaration(node) || !node.name || !node.heritageClauses) {
      return;
    }

    for (const clause of node.heritageClauses) {
      if (clause.token !== ts.SyntaxKind.ExtendsKeyword) {
        continue;
      }

      for (const typeNode of clause.types) {
        const text = typeNode.expression.getText(sourceFile);
        if (text === "Error" || text === "AppError") {
          addViolation(relativePath, node.name, "Custom error classes must live in src/shared/errors.ts");
        }
      }
    }
  });
}

function checkReqValidUsage(relativePath, sourceFile) {
  visit(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
      return;
    }

    const expression = node.expression;
    if (!ts.isPropertyAccessExpression(expression.expression)) {
      return;
    }

    if (expression.expression.name.text !== "req") {
      return;
    }

    const method = expression.name.text;
    if (DISALLOWED_REQ_METHODS.has(method) && isRouteModule(relativePath)) {
      addViolation(relativePath, node, `Use c.req.valid(...) instead of c.req.${method}(...)`);
      return;
    }

    if (method !== "valid") {
      return;
    }

    if (!isRouteModule(relativePath)) {
      addViolation(relativePath, node, "c.req.valid(...) is only allowed in HTTP route modules");
      return;
    }

    const [firstArg] = node.arguments;
    if (!firstArg || !ts.isStringLiteral(firstArg) || !ALLOWED_VALID_KINDS.has(firstArg.text)) {
      addViolation(relativePath, node, "c.req.valid(...) must use one of: param, query, json, header");
    }
  });
}

function checkNoPlainZodImport(relativePath, sourceFile) {
  for (const importNode of getImportDeclarations(sourceFile)) {
    if (importNode.moduleSpecifier.text === "zod") {
      addViolation(relativePath, importNode.moduleSpecifier, "Route and shared validation schemas must import z from @hono/zod-openapi");
    }
  }
}

function checkRouteModule(relativePath, sourceFile) {
  const routeDefinitions = new Map();
  let createRouteImported = false;
  let openapiCalls = 0;

  for (const importNode of getImportDeclarations(sourceFile)) {
    if (importNode.moduleSpecifier.text !== "@hono/zod-openapi") {
      continue;
    }

    if (!importNode.importClause?.namedBindings || !ts.isNamedImports(importNode.importClause.namedBindings)) {
      continue;
    }

    createRouteImported = importNode.importClause.namedBindings.elements.some((element) => element.name.text === "createRoute");
  }

  visit(sourceFile, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && ts.isCallExpression(node.initializer)) {
      if (isIdentifierText(node.initializer.expression, "createRoute")) {
        const [config] = node.initializer.arguments;
        if (config && ts.isObjectLiteralExpression(config)) {
          routeDefinitions.set(node.name.text, config);
        }
      }
    }

    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
      return;
    }

    const propertyName = node.expression.name.text;
    if (isIdentifierText(node.expression.expression, "app") && ROUTE_METHODS.has(propertyName)) {
      addViolation(relativePath, node, "Route modules must register endpoints with createRoute(...) and app.openapi(...)");
      return;
    }

    if (!isIdentifierText(node.expression.expression, "app") || propertyName !== "openapi") {
      return;
    }

    openapiCalls += 1;

    const [routeArg, handlerArg] = node.arguments;
    const routeConfig = resolveRouteConfig(routeArg, routeDefinitions);
    const handler = ts.isArrowFunction(handlerArg) || ts.isFunctionExpression(handlerArg) ? handlerArg : null;

    if (!routeConfig) {
      addViolation(relativePath, node, "app.openapi(...) must use a route created by createRoute(...)");
      return;
    }

    if (!handler) {
      addViolation(relativePath, node, "app.openapi(...) must receive an inline handler");
      return;
    }

    const executeCalls = findDescendants(handler.body, (child) =>
      ts.isCallExpression(child)
      && ts.isPropertyAccessExpression(child.expression)
      && child.expression.name.text === "execute",
    );

    if (executeCalls.length !== 1) {
      addViolation(relativePath, handler, `Route handlers must call exactly one use case .execute(...); found ${executeCalls.length}`);
    }

    const requireActorCalls = findDescendants(handler.body, (child) =>
      ts.isCallExpression(child) && isIdentifierText(child.expression, "requireActor"),
    );

    const hasSecurity = routeConfig.properties.some((property) =>
      ts.isPropertyAssignment(property)
      && getPropertyName(property.name) === "security",
    );

    if (requireActorCalls.length > 0 && !hasSecurity) {
      addViolation(relativePath, routeConfig, "Protected routes using requireActor(c) must declare security: bearerSecurity");
    }

    if (hasSecurity && requireActorCalls.length === 0) {
      addViolation(relativePath, routeConfig, "Routes declaring security: bearerSecurity must call requireActor(c) in the handler");
    }
  });

  if (!createRouteImported) {
    addViolation(relativePath, sourceFile, "Route modules must import createRoute from @hono/zod-openapi");
  }

  if (openapiCalls === 0) {
    addViolation(relativePath, sourceFile, "Route modules must register endpoints with app.openapi(...)");
  }
}

function checkRepositoryOrWorkflow(relativePath, sourceFile) {
  const mapperImports = getImportDeclarations(sourceFile).filter((node) =>
    node.moduleSpecifier.text.includes("/repositories/mappers/"),
  );

  if (mapperImports.length === 0) {
    addViolation(relativePath, sourceFile, "Repository and workflow implementations must use infrastructure mappers");
  }

  for (const importNode of getImportDeclarations(sourceFile)) {
    const specifier = importNode.moduleSpecifier.text;
    if (/\/domain\/.+\.policy$/.test(specifier) || specifier === "@/domain/authz/assert-can") {
      addViolation(relativePath, importNode.moduleSpecifier, "Repositories and workflows must not own authorization decisions");
    }
  }

  visit(sourceFile, (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (node.expression.name.text === "reconstitute") {
        addViolation(relativePath, node, "Repositories and workflows must reconstitute entities through mappers, not inline");
      }

      if (ts.isPropertyAccessExpression(node.expression.expression)
        && node.expression.expression.expression.kind === ts.SyntaxKind.ThisKeyword
        && node.expression.expression.name.text === "db"
        && ROUTE_METHODS.has(node.expression.name.text)) {
        addViolation(relativePath, node, "Repository and workflow writes must go through CrudAdapter helpers");
      }
    }
  });
}

function checkMapperFile(filePath, relativePath, sourceFile) {
  const exportedFunctions = sourceFile.statements.filter((statement) =>
    ts.isFunctionDeclaration(statement)
    && statement.name
    && hasExportModifier(statement),
  );

  const classEntityNames = getClassEntityNamesForMapper(sourceFile);

  for (const fn of exportedFunctions) {
    const functionName = fn.name.text;
    const parameterNames = new Set(fn.parameters
      .map((parameter) => ts.isIdentifier(parameter.name) ? parameter.name.text : null)
      .filter(Boolean));

    if (/RowToEntity$|ToInsertRow$|ToUpdateRow$|RowToRecord$/.test(functionName) && fn.parameters.length !== 1) {
      addViolation(relativePath, fn.name, `Mapper function ${functionName} must accept exactly one argument`);
    }

    if (fn.parameters.length > 1) {
      addViolation(relativePath, fn.name, `Mapper function ${functionName} must not accept ad hoc scalar arguments`);
    }

    if (fn.body) {
      const returnExpressions = findDescendants(fn.body, (node) => ts.isReturnStatement(node) && Boolean(node.expression))
        .map((node) => node.expression);

      for (const expression of returnExpressions) {
        if (ts.isIdentifier(expression) && parameterNames.has(expression.text)) {
          addViolation(relativePath, expression, `Mapper function ${functionName} must map fields explicitly instead of returning ${expression.text} directly`);
        }

        if (ts.isObjectLiteralExpression(expression)) {
          for (const property of expression.properties) {
            if (ts.isSpreadAssignment(property) && ts.isIdentifier(property.expression) && parameterNames.has(property.expression.text)) {
              addViolation(relativePath, property, `Mapper function ${functionName} must map fields explicitly instead of spreading ${property.expression.text}`);
            }
          }
        }
      }
    }

    if (classEntityNames.length === 0 || !fn.body) {
      continue;
    }

    if (functionName.endsWith("RowToEntity")) {
      const reconstituteCalls = findDescendants(fn.body, (node) =>
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === "reconstitute"
        && ts.isIdentifier(node.expression.expression)
        && classEntityNames.includes(node.expression.expression.text),
      );

      if (reconstituteCalls.length === 0) {
        addViolation(relativePath, fn.name, `Class-entity mapper ${functionName} must rebuild through ${classEntityNames.join(", ")}.reconstitute(...)`);
      }
    }

    if (functionName.endsWith("ToInsertRow") || functionName.endsWith("ToUpdateRow")) {
      const snapshotCalls = findDescendants(fn.body, (node) =>
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === "toSnapshot",
      );

      if (snapshotCalls.length === 0) {
        addViolation(relativePath, fn.name, `Class-entity mapper ${functionName} must derive persistence rows from entity.toSnapshot()`);
      }
    }
  }

  for (const importNode of getImportDeclarations(sourceFile)) {
    const specifier = importNode.moduleSpecifier.text;
    if (specifier.startsWith("@/application/") || specifier.startsWith("@/http/") || specifier.startsWith("@/composition/")) {
      addViolation(relativePath, importNode.moduleSpecifier, `Mapper files must stay in infrastructure/domain boundaries only: ${specifier}`);
    }
  }
}

function checkCrudAdapterJSDoc(relativePath, sourceFile) {
  const classDecl = sourceFile.statements.find((statement) =>
    ts.isClassDeclaration(statement) && statement.name?.text === "CrudAdapter",
  );

  if (!classDecl || !ts.isClassDeclaration(classDecl)) {
    addViolation(relativePath, sourceFile, "CrudAdapter class was not found");
    return;
  }

  for (const member of classDecl.members) {
    if (!ts.isMethodDeclaration(member) || hasModifier(member, ts.SyntaxKind.PrivateKeyword)) {
      continue;
    }

    if (!hasJSDoc(member)) {
      addViolation(relativePath, member.name, "Every public CrudAdapter method must have JSDoc");
    }
  }
}

function getClassEntityNamesForMapper(sourceFile) {
  const names = [];

  for (const importNode of getImportDeclarations(sourceFile)) {
    if (importNode.importClause?.isTypeOnly) {
      continue;
    }

    const specifier = importNode.moduleSpecifier.text;
    if (!specifier.startsWith("@/domain/") || !specifier.endsWith(".entity")) {
      continue;
    }

    if (!importNode.importClause?.namedBindings || !ts.isNamedImports(importNode.importClause.namedBindings)) {
      continue;
    }

    const entitySource = resolveInternalModule(specifier);
    if (!entitySource) {
      continue;
    }

    for (const element of importNode.importClause.namedBindings.elements) {
      const importedName = (element.propertyName ?? element.name).text;
      if (sourceHasExportedClass(entitySource, importedName)) {
        names.push(element.name.text);
      }
    }
  }

  return names;
}

function sourceHasExportedClass(filePath, className) {
  const sourceFile = sourceFiles.get(filePath);
  if (!sourceFile) {
    return false;
  }

  return sourceFile.statements.some((statement) =>
    ts.isClassDeclaration(statement)
    && statement.name?.text === className
    && hasExportModifier(statement),
  );
}

function resolveRouteConfig(routeArg, routeDefinitions) {
  if (!routeArg) {
    return null;
  }

  if (ts.isIdentifier(routeArg)) {
    return routeDefinitions.get(routeArg.text) ?? null;
  }

  return ts.isObjectLiteralExpression(routeArg) ? routeArg : null;
}

function getImportDeclarations(sourceFile) {
  return sourceFile.statements.filter((statement) => ts.isImportDeclaration(statement));
}

function getLayer(relativePath) {
  if (!relativePath.startsWith("src/")) {
    return null;
  }

  const [, layer] = relativePath.split("/");
  return layer ?? null;
}

function isRouteModule(relativePath) {
  return /^src\/http\/routes\/.+\.routes\.ts$/.test(relativePath);
}

function isRepositoryOrWorkflow(relativePath) {
  return /^src\/infrastructure\/repositories\/drizzle-.*\.(repository|workflow)\.ts$/.test(relativePath);
}

function isMapperFile(relativePath) {
  return /^src\/infrastructure\/repositories\/mappers\/.+\.mapper\.ts$/.test(relativePath);
}

function resolveInternalModule(specifier) {
  const basePath = path.join(ROOT, "src", specifier.slice(2));
  const candidates = [
    `${basePath}.ts`,
    `${basePath}.d.ts`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.d.ts"),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function findDescendants(rootNode, predicate) {
  const matches = [];

  visit(rootNode, (node) => {
    if (predicate(node)) {
      matches.push(node);
    }
  });

  return matches;
}

function visit(node, cb) {
  cb(node);
  ts.forEachChild(node, (child) => visit(child, cb));
}

function hasExportModifier(node) {
  return hasModifier(node, ts.SyntaxKind.ExportKeyword);
}

function hasModifier(node, kind) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === kind));
}

function hasJSDoc(node) {
  return ts.getLeadingCommentRanges(node.getFullText(), 0)?.some((range) =>
    node.getFullText().slice(range.pos, range.end).startsWith("/**"),
  ) ?? false;
}

function getModuleSpecifier(node) {
  if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) {
    return null;
  }

  return node.moduleSpecifier.text;
}

function getPropertyName(nameNode) {
  if (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode)) {
    return nameNode.text;
  }

  return null;
}

function isIdentifierText(node, text) {
  return ts.isIdentifier(node) && node.text === text;
}

function createSourceFile(filePath) {
  return ts.createSourceFile(filePath, fs.readFileSync(filePath, "utf8"), ts.ScriptTarget.Latest, true);
}

function walkTsFiles(dirPath) {
  const files = [];

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTsFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

function toRepoPath(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

function addViolation(file, node, message) {
  const sourceFile = ts.isSourceFile(node) ? node : node.getSourceFile();
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  violations.push({
    file,
    line: line + 1,
    column: character + 1,
    message,
  });
}

function compareViolations(left, right) {
  return left.file.localeCompare(right.file)
    || left.line - right.line
    || left.column - right.column
    || left.message.localeCompare(right.message);
}
