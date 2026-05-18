var STORAGE_ERROR_PATTERNS = [
  /UNIQUE constraint failed/i,
  /\bSQLite\b/i,
  /\bD1\b/i,
  /\bDrizzle\b/i,
];

var ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete"]);
var DISALLOWED_REQ_METHODS = new Set(["json", "text", "formData", "parseBody", "query", "queries", "param", "header"]);
var ALLOWED_VALID_KINDS = new Set(["param", "query", "json", "header"]);

function getLayer(filename) {
  var srcIndex = filename.lastIndexOf("/src/");
  if (srcIndex === -1) return null;
  var afterSrc = filename.slice(srcIndex + 5);
  var slashIndex = afterSrc.indexOf("/");
  if (slashIndex === -1) return null;
  return afterSrc.slice(0, slashIndex);
}

function isRouteModule(filename) {
  return /.+\/http\/routes\/.+\.routes\.ts$/.test(filename);
}

function isRepositoryOrWorkflow(filename) {
  return /.+\/infrastructure\/repositories\/drizzle-.+\.(repository|workflow)\.ts$/.test(filename);
}

function isMapperFile(filename) {
  return /.+\/repositories\/mappers\/.+\.mapper\.ts$/.test(filename);
}

function isCrudAdapter(filename) {
  return filename.endsWith("/infrastructure/persistence/crud-adapter.ts");
}

function isInSchemaValidationPagination(filename) {
  return filename.includes("/http/schemas/") || filename.includes("/shared/validation/") || filename.includes("/shared/pagination/");
}

function startsWithAny(str, prefixes) {
  return prefixes.some(function (p) { return str.startsWith(p); });
}

function extractImportSource(node) {
  if (node.source && node.source.type === "Literal") {
    return node.source.value;
  }
  return null;
}

function getPropertyName(node) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  return null;
}

function isThisDbExpression(node) {
  return node &&
    node.type === "MemberExpression" &&
    !node.computed &&
    node.object &&
    node.object.type === "ThisExpression" &&
    getPropertyName(node.property) === "db";
}

function findDescendants(root, predicate) {
  var matches = [];
  var visited = new Set();
  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (visited.has(n)) return;
    visited.add(n);
    if (predicate(n)) matches.push(n);
    var keys = Object.keys(n);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (key === "parent") continue;
      var val = n[key];
      if (val && typeof val === "object") {
        if (Array.isArray(val)) {
          for (var j = 0; j < val.length; j++) walk(val[j]);
        } else if (val.type) {
          walk(val);
        }
      }
    }
  }
  walk(root);
  return matches;
}

function isAppOpenapiCall(node) {
  if (!node || node.type !== "CallExpression") return false;
  var callee = node.callee;
  return callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    callee.object.name === "app" &&
    getPropertyName(callee.property) === "openapi";
}

function getInlineOpenapiHandlerBody(node) {
  if (!isAppOpenapiCall(node)) return null;
  var handlerArg = node.arguments[1];
  var isArrow = handlerArg && handlerArg.type === "ArrowFunctionExpression";
  var isFunc = handlerArg && handlerArg.type === "FunctionExpression";
  if (!isArrow && !isFunc) return null;
  return handlerArg.body;
}

function hasJSDoc(context, node) {
  var comments = context.sourceCode.getCommentsBefore(node);
  for (var i = 0; i < comments.length; i++) {
    var v = comments[i].value;
    if (v.charAt(0) === "*") return true;
  }
  return false;
}

function reportProgramError(context, message) {
  context.report({
    loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
    message: message,
  });
}

// ─── Rule 1: layer-imports ────────────────────────────────────────────────
var layerImportsRule = {
  meta: {
    type: "problem",
    docs: { description: "Enforce layer dependency boundaries" },
    schema: [{
      type: "object",
      properties: {
        internalAllowed: { type: "object" },
        externalBanned: { type: "object" },
      },
    }],
  },
  create: function (context) {
    var opts = context.options[0] || {};
    var internalAllowed = opts.internalAllowed || {};
    var externalBanned = opts.externalBanned || {};
    var filename = context.filename || context.physicalFilename || "";
    var layer = getLayer(filename);

    return {
      ImportDeclaration: function (node) {
        var spec = extractImportSource(node);
        if (!spec) return;

        if (spec.startsWith("@/") && layer && internalAllowed[layer]) {
          if (!startsWithAny(spec, internalAllowed[layer])) {
            context.report({ node: node.source, message: "Disallowed " + layer + " import: " + spec });
          }
        }

        if (!spec.startsWith("@/") && layer && externalBanned[layer]) {
          var banned = externalBanned[layer];
          for (var i = 0; i < banned.length; i++) {
            var p = banned[i];
            if (typeof p === "string") {
              var starts = spec === p || (spec.length > p.length && spec.slice(0, p.length) === p && (spec[p.length] === "/" || spec[p.length] === ":"));
              if (starts) {
                context.report({ node: node.source, message: "Disallowed external import in " + layer + " layer: " + spec });
                break;
              }
            }
          }
        }
      },

      ExportNamedDeclaration: function (node) {
        var spec = extractImportSource(node);
        if (!spec || !spec.startsWith("@/") || !layer || !internalAllowed[layer]) return;
        if (!startsWithAny(spec, internalAllowed[layer])) {
          context.report({ node: node.source, message: "Disallowed " + layer + " re-export: " + spec });
        }
      },

      ExportAllDeclaration: function (node) {
        if (!node.source || node.source.type !== "Literal") return;
        var spec = node.source.value;
        if (!spec.startsWith("@/") || !layer || !internalAllowed[layer]) return;
        if (!startsWithAny(spec, internalAllowed[layer])) {
          context.report({ node: node.source, message: "Disallowed " + layer + " re-export: " + spec });
        }
      },
    };
  },
};

// ─── Rule 2: no-mapper-imports-outside-infra ──────────────────────────────
var noMapperImportsOutsideInfraRule = {
  meta: { type: "problem", docs: { description: "Mapper imports only inside infrastructure" } },
  create: function (context) {
    var filename = context.filename || context.physicalFilename || "";
    if (filename.includes("/infrastructure/")) return {};
    return {
      ImportDeclaration: function (node) {
        var spec = extractImportSource(node);
        if (spec && spec.includes("/repositories/mappers/")) {
          context.report({ node: node.source, message: "Mapper imports are only allowed inside infrastructure: " + spec });
        }
      },
    };
  },
};

// ─── Rule 3: no-storage-error-parsing ─────────────────────────────────────
var noStorageErrorParsingRule = {
  meta: { type: "problem", docs: { description: "Storage error parsing stays in infrastructure" } },
  create: function (context) {
    var filename = context.filename || context.physicalFilename || "";
    if (!/\/src\/(application|domain|http|shared)\//.test(filename)) return {};
    if (filename.endsWith("/src/shared/errors.ts")) return {};
    return {
      Literal: function (node) {
        if (typeof node.value !== "string") return;
        for (var i = 0; i < STORAGE_ERROR_PATTERNS.length; i++) {
          if (STORAGE_ERROR_PATTERNS[i].test(node.value)) {
            context.report({ node: node, message: "Storage-driver parsing terms must stay in infrastructure helpers: " + node.value });
            return;
          }
        }
      },
      TemplateElement: function (node) {
        var value = node.value && (node.value.cooked || node.value.raw);
        if (typeof value !== "string") return;
        for (var i = 0; i < STORAGE_ERROR_PATTERNS.length; i++) {
          if (STORAGE_ERROR_PATTERNS[i].test(value)) {
            context.report({ node: node, message: "Storage-driver parsing terms must stay in infrastructure helpers: " + value });
            return;
          }
        }
      },
    };
  },
};

// ─── Rule 4: no-custom-errors-outside-shared ──────────────────────────────
var noCustomErrorsOutsideSharedRule = {
  meta: { type: "problem", docs: { description: "Custom errors must be in shared/errors.ts" } },
  create: function (context) {
    var filename = context.filename || context.physicalFilename || "";
    if (filename.endsWith("/src/shared/errors.ts")) return {};
    return {
      ClassDeclaration: function (node) {
        if (!node.id || !node.superClass) return;
        if (node.superClass.type === "Identifier") {
          var name = node.superClass.name;
          if (name === "Error" || name === "AppError") {
            context.report({ node: node.id, message: "Custom error classes must live in src/shared/errors.ts" });
          }
        }
      },
    };
  },
};

// ─── Rule 5: req-valid-usage ──────────────────────────────────────────────
var reqValidUsageRule = {
  meta: { type: "problem", docs: { description: "Enforce c.req.valid(...) usage" } },
  create: function (context) {
    var filename = context.filename || context.physicalFilename || "";
    return {
      CallExpression: function (node) {
        var callee = node.callee;
        if (callee.type !== "MemberExpression") return;
        if (callee.computed || callee.property.type !== "Identifier") return;
        var method = callee.property.name;
        var obj = callee.object;
        if (obj.type !== "MemberExpression" || obj.computed) return;
        if (getPropertyName(obj.property) !== "req") return;

        if (DISALLOWED_REQ_METHODS.has(method) && isRouteModule(filename)) {
          context.report({ node: node, message: "Use req.valid(...) instead of raw req." + method + "(...) in route modules" });
          return;
        }
        if (method !== "valid") return;
        if (!isRouteModule(filename)) {
          context.report({ node: node, message: "c.req.valid(...) is only allowed in HTTP route modules" });
          return;
        }
        var firstArg = node.arguments[0];
        if (!firstArg || firstArg.type !== "Literal" || typeof firstArg.value !== "string" || !ALLOWED_VALID_KINDS.has(firstArg.value)) {
          context.report({ node: node, message: "c.req.valid(...) must use one of: param, query, json, header" });
        }
      },
    };
  },
};

// ─── Rule 6: no-plain-zod-import ──────────────────────────────────────────
var noPlainZodImportRule = {
  meta: { type: "problem", docs: { description: "No plain zod import in schema files" } },
  create: function (context) {
    var filename = context.filename || context.physicalFilename || "";
    if (!isInSchemaValidationPagination(filename)) return {};
    return {
      ImportDeclaration: function (node) {
        var spec = extractImportSource(node);
        if (spec === "zod") {
          context.report({ node: node.source, message: "Route and shared validation schemas must import z from @hono/zod-openapi" });
        }
      },
    };
  },
};

// ─── Rule 7: route-module ─────────────────────────────────────────────────
var routeModuleRule = {
  meta: { type: "problem", docs: { description: "Enforce createRoute + app.openapi pattern" } },
  create: function (context) {
    var filename = context.filename || context.physicalFilename || "";
    if (!isRouteModule(filename)) return {};

    var createRouteImported = false;
    var routeDefinitions = {};
    var openapiCalls = 0;
    var handlerBodies = [];

    return {
      ImportDeclaration: function (node) {
        var spec = extractImportSource(node);
        if (spec !== "@hono/zod-openapi") return;
        if (!node.specifiers) return;
        for (var i = 0; i < node.specifiers.length; i++) {
          var s = node.specifiers[i];
          if (s.type === "ImportSpecifier" && s.imported && s.imported.name === "createRoute") {
            createRouteImported = true;
          }
        }
      },

      VariableDeclarator: function (node) {
        if (!node.id || node.id.type !== "Identifier" || !node.init) return;
        if (node.init.type !== "CallExpression") return;
        if (node.init.callee.type !== "Identifier" || node.init.callee.name !== "createRoute") return;
        var config = node.init.arguments[0];
        if (config && config.type === "ObjectExpression") {
          routeDefinitions[node.id.name] = config;
        }
      },

      CallExpression: function (node) {
        var callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        if (callee.property.type !== "Identifier") return;
        var prop = callee.property.name;
        if (callee.object.type !== "Identifier" || callee.object.name !== "app") return;

        if (ROUTE_METHODS.has(prop) && prop !== "openapi") {
          context.report({ node: node, message: "Route modules must register endpoints with createRoute(...) and app.openapi(...)" });
          return;
        }
        if (prop !== "openapi") return;

        openapiCalls++;

        var routeArg = node.arguments[0];
        var handlerArg = node.arguments[1];

        var foundRoute = false;
        if (routeArg) {
          if (routeArg.type === "Identifier" && routeDefinitions[routeArg.name]) {
            foundRoute = true;
          } else if (routeArg.type === "ObjectExpression") {
            foundRoute = true;
          }
        }

        if (!foundRoute) {
          context.report({ node: node, message: "app.openapi(...) must use a route created by createRoute(...)" });
          return;
        }

        var isArrow = handlerArg && handlerArg.type === "ArrowFunctionExpression";
        var isFunc = handlerArg && handlerArg.type === "FunctionExpression";
        if (!isArrow && !isFunc) {
          context.report({ node: node, message: "app.openapi(...) must receive an inline handler" });
          return;
        }

        handlerBodies.push({
          handlerBody: handlerArg.body,
          routeConfig: routeArg.type === "Identifier" ? routeDefinitions[routeArg.name] : routeArg,
        });
      },

      "Program:exit": function () {
        if (!createRouteImported) {
          reportProgramError(context, "Route modules must import createRoute from @hono/zod-openapi");
        }
        if (openapiCalls === 0) {
          reportProgramError(context, "Route modules must register endpoints with app.openapi(...)");
        }

        for (var i = 0; i < handlerBodies.length; i++) {
          var hb = handlerBodies[i];

          var execCount = 0;
          var seen = new Set();
          function countExecute(n) {
            if (!n || typeof n !== "object" || seen.has(n)) return;
            seen.add(n);
            if (n.type === "CallExpression" &&
                n.callee.type === "MemberExpression" &&
                !n.callee.computed &&
                n.callee.property.type === "Identifier" &&
                n.callee.property.name === "execute") {
              execCount++;
            }
            var keys = Object.keys(n);
            for (var k = 0; k < keys.length; k++) {
              var key = keys[k];
              if (key === "parent") continue;
              var val = n[key];
              if (val && typeof val === "object") {
                if (Array.isArray(val)) {
                  for (var a = 0; a < val.length; a++) countExecute(val[a]);
                } else if (val.type) {
                  countExecute(val);
                }
              }
            }
          }
          countExecute(hb.handlerBody);

          if (execCount !== 1) {
            context.report({ node: hb.handlerBody, message: "Route handlers must call exactly one use case .execute(...); found " + execCount });
          }

          var requireActorCalls = findDescendants(hb.handlerBody, function (n) {
            return n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "requireActor";
          });

          var hasSecurity = false;
          var hasBearerSecurity = false;
          if (hb.routeConfig && hb.routeConfig.type === "ObjectExpression") {
            for (var j = 0; j < hb.routeConfig.properties.length; j++) {
              var prop = hb.routeConfig.properties[j];
              if (prop.type === "Property" && getPropertyName(prop.key) === "security") {
                hasSecurity = true;
                hasBearerSecurity = prop.value && prop.value.type === "Identifier" && prop.value.name === "bearerSecurity";
                break;
              }
            }
          }

          if (requireActorCalls.length > 0 && !hasBearerSecurity) {
            context.report({ node: hb.routeConfig || hb.handlerBody, message: "Protected routes using requireActor(c) must declare security: bearerSecurity" });
          }
          if (hasSecurity && requireActorCalls.length === 0) {
            context.report({ node: hb.routeConfig || hb.handlerBody, message: "Routes declaring security: bearerSecurity must call requireActor(c) in the handler" });
          }
        }
      },
    };
  },
};

// ─── Rule 8: route-handler-boundary ──────────────────────────────────────
var ROUTE_FORBIDDEN_STORAGE_METHODS = new Set(["batch", "delete", "exec", "insert", "prepare", "select", "update"]);

function isCEnvAccess(node) {
  return node &&
    node.type === "MemberExpression" &&
    !node.computed &&
    node.object.type === "Identifier" &&
    node.object.name === "c" &&
    getPropertyName(node.property) === "env";
}

function isJsonParseOrStringifyCall(node) {
  return node &&
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    !node.callee.computed &&
    node.callee.object.type === "Identifier" &&
    node.callee.object.name === "JSON" &&
    (getPropertyName(node.callee.property) === "parse" || getPropertyName(node.callee.property) === "stringify");
}

function isStorageLikeCall(node) {
  if (!node || node.type !== "CallExpression") return false;
  if (node.callee.type !== "MemberExpression" || node.callee.computed) return false;
  return ROUTE_FORBIDDEN_STORAGE_METHODS.has(getPropertyName(node.callee.property));
}

var routeHandlerBoundaryRule = {
  meta: { type: "problem", docs: { description: "Route handlers stay at HTTP orchestration boundaries" } },
  create: function (context) {
    var filename = context.filename || context.physicalFilename || "";
    if (!isRouteModule(filename)) return {};

    return {
      CallExpression: function (node) {
        var handlerBody = getInlineOpenapiHandlerBody(node);
        if (!handlerBody) return;

        var envAccesses = findDescendants(handlerBody, isCEnvAccess);
        for (var e = 0; e < envAccesses.length; e++) {
          context.report({ node: envAccesses[e], message: "Route handlers must not read c.env directly; use composition/use cases for runtime dependencies" });
        }

        var lowLevelCalls = findDescendants(handlerBody, function (n) {
          if (n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "fetch") return true;
          if (n.type === "CallExpression" && n.callee.type === "MemberExpression" && !n.callee.computed && n.callee.object.type === "Identifier" && n.callee.object.name === "crypto") return true;
          if (isJsonParseOrStringifyCall(n)) return true;
          if (isStorageLikeCall(n)) return true;
          return false;
        });

        for (var i = 0; i < lowLevelCalls.length; i++) {
          context.report({ node: lowLevelCalls[i], message: "Route handlers must stay thin: validate input, call one use case, and present the response" });
        }

        var lowLevelNews = findDescendants(handlerBody, function (n) {
          return n.type === "NewExpression" &&
            n.callee.type === "Identifier" &&
            (n.callee.name === "Request" || n.callee.name === "Response");
        });

        for (var r = 0; r < lowLevelNews.length; r++) {
          context.report({ node: lowLevelNews[r], message: "Route handlers must use Hono response helpers and presenters, not construct Request/Response directly" });
        }
      },
    };
  },
};

// ─── Rule 9: repository-workflow ──────────────────────────────────────────
var repositoryWorkflowRule = {
  meta: { type: "problem", docs: { description: "Repository and workflow rules" } },
  create: function (context) {
    var filename = context.filename || context.physicalFilename || "";
    if (!isRepositoryOrWorkflow(filename)) return {};
    var mapperImports = 0;
    var isWorkflow = /.+\.workflow\.ts$/.test(filename);
    var dbWriteMethods = new Set(["insert", "update", "delete"]);

    return {
      ImportDeclaration: function (node) {
        var spec = extractImportSource(node);
        if (spec && spec.includes("/repositories/mappers/")) mapperImports++;
        if (spec && (/\/domain\/.+\.policy$/.test(spec) || spec === "@/domain/authz/assert-can")) {
          context.report({ node: node.source, message: "Repositories and workflows must not own authorization decisions" });
        }
      },
      CallExpression: function (node) {
        if (node.callee.type === "MemberExpression" && !node.callee.computed) {
          if (node.callee.property.type === "Identifier" && node.callee.property.name === "reconstitute") {
            context.report({ node: node, message: "Repositories and workflows must reconstitute entities through mappers, not inline" });
          }
          if (isThisDbExpression(node.callee.object) && dbWriteMethods.has(getPropertyName(node.callee.property))) {
            context.report({ node: node, message: "Repository and workflow writes must go through CrudAdapter helpers" });
          }
          if (!isWorkflow && isThisDbExpression(node.callee.object) && getPropertyName(node.callee.property) === "batch") {
            context.report({ node: node, message: "db.batch(...) is only allowed in infrastructure workflow ports" });
          }
        }
      },
      "Program:exit": function () {
        if (mapperImports === 0) {
          reportProgramError(context, "Repository and workflow implementations must use infrastructure mappers");
        }
      },
    };
  },
};

// ─── Rule 10: mapper-file ─────────────────────────────────────────────────
var mapperFileRule = {
  meta: { type: "problem", docs: { description: "Mapper function rules" } },
  create: function (context) {
    var filename = context.filename || context.physicalFilename || "";
    if (!isMapperFile(filename)) return {};

    var exportedFunctions = [];
    var disallowedImports = [];
    var hasDomainEntityImport = false;

    return {
      ImportDeclaration: function (node) {
        var spec = extractImportSource(node);
        if (!spec) return;
        if (spec.startsWith("@/application/") || spec.startsWith("@/http/") || spec.startsWith("@/composition/")) {
          disallowedImports.push(spec);
        }
        if (/\/domain\/.+\.entity$/.test(spec)) {
          hasDomainEntityImport = true;
        }
      },

      ExportNamedDeclaration: function (node) {
        if (node.declaration && node.declaration.type === "FunctionDeclaration" && node.declaration.id) {
          exportedFunctions.push(node.declaration);
        }
      },

      ExportDefaultDeclaration: function (node) {
        if (node.declaration && node.declaration.type === "FunctionDeclaration" && node.declaration.id) {
          exportedFunctions.push(node.declaration);
        }
      },

      "Program:exit": function () {
        for (var d = 0; d < disallowedImports.length; d++) {
          reportProgramError(context, "Mapper files must stay in infrastructure/domain boundaries only: " + disallowedImports[d]);
        }

        for (var i = 0; i < exportedFunctions.length; i++) {
          var fn = exportedFunctions[i];
          var name = fn.id.name;

          var paramSet = new Set();
          for (var p = 0; p < fn.params.length; p++) {
            if (fn.params[p].type === "Identifier") paramSet.add(fn.params[p].name);
          }

          if (/RowToEntity$|ToInsertRow$|ToUpdateRow$|RowToRecord$/.test(name) && fn.params.length !== 1) {
            context.report({ node: fn.id, message: "Mapper function " + name + " must accept exactly one argument" });
          }

          if (fn.params.length > 1) {
            context.report({ node: fn.id, message: "Mapper function " + name + " must not accept ad hoc scalar arguments" });
          }

          if (fn.body) {
            var returnStmts = findDescendants(fn.body, function (n) {
              return n.type === "ReturnStatement" && n.argument !== null && typeof n.argument !== "undefined";
            });

            for (var r = 0; r < returnStmts.length; r++) {
              var expr = returnStmts[r].argument;
              if (expr.type === "Identifier" && paramSet.has(expr.name)) {
                context.report({ node: expr, message: "Mapper function " + name + " must map fields explicitly instead of returning " + expr.name + " directly" });
              }
              if (expr.type === "ObjectExpression") {
                for (var j = 0; j < expr.properties.length; j++) {
                  var prop = expr.properties[j];
                  if (prop.type === "SpreadElement" && prop.argument.type === "Identifier" && paramSet.has(prop.argument.name)) {
                    context.report({ node: prop, message: "Mapper function " + name + " must map fields explicitly instead of spreading " + prop.argument.name });
                  }
                }
              }
            }
          }

          if (!hasDomainEntityImport) continue;

          if (name.endsWith("RowToEntity")) {
            if (fn.body) {
              var reconCalls = findDescendants(fn.body, function (n) {
                return n.type === "CallExpression" &&
                  n.callee.type === "MemberExpression" &&
                  !n.callee.computed &&
                  n.callee.property.type === "Identifier" &&
                  n.callee.property.name === "reconstitute";
              });
              if (reconCalls.length === 0) {
                context.report({ node: fn.id, message: "Mapper " + name + " must rebuild through Entity.reconstitute(...)" });
              }
            } else {
              context.report({ node: fn.id, message: "Mapper " + name + " must rebuild through Entity.reconstitute(...)" });
            }
          }

          if (name.endsWith("ToInsertRow") || name.endsWith("ToUpdateRow")) {
            if (fn.body) {
              var snapCalls = findDescendants(fn.body, function (n) {
                return n.type === "CallExpression" &&
                  n.callee.type === "MemberExpression" &&
                  !n.callee.computed &&
                  n.callee.property.type === "Identifier" &&
                  n.callee.property.name === "toSnapshot";
              });
              if (snapCalls.length === 0) {
                context.report({ node: fn.id, message: "Mapper " + name + " must derive persistence rows from entity.toSnapshot()" });
              }
            } else {
              context.report({ node: fn.id, message: "Mapper " + name + " must derive persistence rows from entity.toSnapshot()" });
            }
          }
        }
      },
    };
  },
};

// ─── Rule 11: entity-class ────────────────────────────────────────────────
function isEntityFile(filename) {
  return /.+\/domain\/.+\.entity\.ts$/.test(filename);
}

function isExported(node) {
  if (!node.parent) return false;
  return node.parent.type === "ExportNamedDeclaration" || node.parent.type === "ExportDefaultDeclaration";
}

function getNodeName(node) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal") return String(node.value);
  return null;
}

function isTypeDeclaration(node) {
  return node && (
    node.type === "TSTypeAliasDeclaration" ||
    node.type === "TSInterfaceDeclaration"
  );
}

function isPrivatePropsParameter(param) {
  if (!param) return false;
  if (param.type === "TSParameterProperty") {
    var inner = param.parameter;
    return param.accessibility === "private" && inner && inner.type === "Identifier" && inner.name === "props";
  }
  return param.type === "Identifier" && param.name === "props" && param.accessibility === "private";
}

function getTypeLiteralNames(node) {
  var names = [];
  if (!node || node.type !== "TSLiteralType" || !node.literal) return names;
  if (node.literal.type === "Literal" && typeof node.literal.value === "string") {
    names.push(node.literal.value);
  } else if (node.literal.type === "StringLiteral" && typeof node.literal.value === "string") {
    names.push(node.literal.value);
  }
  return names;
}

function collectStringLiteralTypeNames(node) {
  if (!node) return [];
  if (node.type === "TSUnionType") {
    var out = [];
    for (var i = 0; i < node.types.length; i++) {
      out = out.concat(collectStringLiteralTypeNames(node.types[i]));
    }
    return out;
  }
  return getTypeLiteralNames(node);
}

function getCreatePropsTypeInfo(typeAnnotation) {
  if (typeAnnotation && typeAnnotation.type === "TSTypeAnnotation") {
    typeAnnotation = typeAnnotation.typeAnnotation;
  }
  if (!typeAnnotation || typeAnnotation.type !== "TSTypeReference") return null;
  if (!typeAnnotation.typeName || typeAnnotation.typeName.type !== "Identifier") return null;

  var helper = typeAnnotation.typeName.name;
  var typeParameters = typeAnnotation.typeParameters || typeAnnotation.typeArguments;
  var params = typeParameters && typeParameters.params
    ? typeParameters.params
    : [];
  if (helper !== "Omit" || params.length < 2) return null;

  var sourceType = params[0];
  if (!sourceType || sourceType.type !== "TSTypeReference" || !sourceType.typeName || sourceType.typeName.type !== "Identifier") {
    return null;
  }

  return {
    helper: helper,
    sourceType: sourceType.typeName.name,
    fields: collectStringLiteralTypeNames(params[1]),
  };
}

function getCreateGeneratedKeys(classNode) {
  var methods = classNode.body && classNode.body.body ? classNode.body.body : [];
  var createMethod = null;
  for (var i = 0; i < methods.length; i++) {
    var method = methods[i];
    if (method.type === "MethodDefinition" &&
        method.static &&
        method.key &&
        method.key.type === "Identifier" &&
        method.key.name === "create") {
      createMethod = method;
      break;
    }
  }
  if (!createMethod || !createMethod.value || !createMethod.value.body) return [];

  var generated = new Set();
  var newExpressions = findDescendants(createMethod.value.body, function (n) {
    return n.type === "NewExpression" && n.arguments && n.arguments.length > 0;
  });

  for (var n = 0; n < newExpressions.length; n++) {
    var arg = newExpressions[n].arguments[0];
    if (!arg || arg.type !== "ObjectExpression") continue;
    for (var p = 0; p < arg.properties.length; p++) {
      var prop = arg.properties[p];
      if (prop.type !== "Property") continue;
      if (prop.key.type === "Identifier") {
        generated.add(prop.key.name);
      } else if (prop.key.type === "Literal" && typeof prop.key.value === "string") {
        generated.add(prop.key.value);
      }
    }
  }

  return Array.from(generated);
}

function getParamTypeName(param) {
  if (!param || param.type !== "Identifier" || !param.typeAnnotation) return null;
  var annotation = param.typeAnnotation;
  if (annotation.type === "TSTypeAnnotation") {
    annotation = annotation.typeAnnotation;
  }
  if (!annotation || annotation.type !== "TSTypeReference" || !annotation.typeName) return null;
  return annotation.typeName.type === "Identifier" ? annotation.typeName.name : null;
}

var REQUIRED_STATIC_METHODS = ["create", "reconstitute"];
var REQUIRED_INSTANCE_METHODS = ["toSnapshot"];

var entityClassRule = {
  meta: { type: "problem", docs: { description: "Entity .entity.ts files must export a class with create, reconstitute, and toSnapshot" } },
  create: function (context) {
    var filename = context.filename || context.physicalFilename || "";
    if (!isEntityFile(filename)) return {};

    var declaredClasses = {};
    var exportedClassNames = {};
    var exportedTypeNames = [];
    var exportedTypeAliases = {};

    return {
      ClassDeclaration: function (node) {
        if (!node.id) return;
        declaredClasses[node.id.name] = node;
        if (isExported(node)) {
          exportedClassNames[node.id.name] = true;
        }
      },

      ExportNamedDeclaration: function (node) {
        if (node.declaration) {
          if (node.declaration.type === "ClassDeclaration" && node.declaration.id) {
            declaredClasses[node.declaration.id.name] = node.declaration;
            exportedClassNames[node.declaration.id.name] = true;
          }
          if (isTypeDeclaration(node.declaration) && node.declaration.id) {
            exportedTypeNames.push(node.declaration.id.name);
            if (node.declaration.type === "TSTypeAliasDeclaration") {
              exportedTypeAliases[node.declaration.id.name] = node.declaration;
            }
          }
          return;
        }
        for (var s = 0; s < node.specifiers.length; s++) {
          var specifier = node.specifiers[s];
          var localName = getNodeName(specifier.local);
          var exportedName = getNodeName(specifier.exported);
          if (node.exportKind === "type" || specifier.exportKind === "type") {
            if (exportedName) exportedTypeNames.push(exportedName);
            continue;
          }
          if (localName && declaredClasses[localName]) {
            exportedClassNames[localName] = true;
          }
        }
      },

      "Program:exit": function () {
        var exportedClasses = Object.keys(exportedClassNames).map(function (name) {
          return declaredClasses[name];
        }).filter(Boolean);

        if (exportedClasses.length === 0) {
          var typeNames = exportedTypeNames.length > 0 ? " Exports found: " + exportedTypeNames.join(", ") + "." : "";
          context.report({
            loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
            message: "Entity files must export a class with a private props constructor, static create(), static reconstitute(), and toSnapshot()." + typeNames,
          });
          return;
        }

        for (var i = 0; i < exportedClasses.length; i++) {
          var cls = exportedClasses[i];
          var body = cls.body && cls.body.body;
          if (!body) continue;

          var staticMethods = {};
          var instanceMethods = {};
          var constructorMethod = null;

          for (var j = 0; j < body.length; j++) {
            var m = body[j];
            if (m.type !== "MethodDefinition") continue;
            if (m.key.type !== "Identifier") continue;
            var name = m.key.name;
            if (name === "constructor") {
              constructorMethod = m;
              if (m.accessibility !== "private") {
                context.report({ node: m.key, message: "Entity " + cls.id.name + " constructor must be private" });
              }
              continue;
            }
            if (m.static) {
              staticMethods[name] = m;
            } else {
              instanceMethods[name] = m;
            }
          }

          if (!constructorMethod) {
            context.report({ node: cls.id, message: "Entity " + cls.id.name + " must define a private constructor(private props: XxxProps)" });
          } else {
            var params = constructorMethod.value && constructorMethod.value.params ? constructorMethod.value.params : [];
            if (params.length !== 1 || !isPrivatePropsParameter(params[0])) {
              context.report({ node: constructorMethod.key, message: "Entity " + cls.id.name + " constructor must be private constructor(private props: XxxProps)" });
            }
          }

          for (var r = 0; r < REQUIRED_STATIC_METHODS.length; r++) {
            var req = REQUIRED_STATIC_METHODS[r];
            if (!staticMethods[req]) {
              context.report({ node: cls.id, message: "Entity " + cls.id.name + " must define static " + req + "()" });
            }
          }
          for (var r2 = 0; r2 < REQUIRED_INSTANCE_METHODS.length; r2++) {
            var req2 = REQUIRED_INSTANCE_METHODS[r2];
            if (!instanceMethods[req2]) {
              context.report({ node: cls.id, message: "Entity " + cls.id.name + " must define " + req2 + "()" });
            }
          }

          var createPropsName = "Create" + cls.id.name + "Props";
          var propsName = cls.id.name + "Props";
          var createMethod = staticMethods.create;
          var createParams = createMethod && createMethod.value && createMethod.value.params ? createMethod.value.params : [];
          if (getParamTypeName(createParams[0]) !== createPropsName) {
            context.report({ node: createMethod ? createMethod.key : cls.id, message: "Entity " + cls.id.name + ".create(...) must accept input: " + createPropsName });
          }

          var createProps = exportedTypeAliases[createPropsName];
          if (!createProps) {
            context.report({ node: cls.id, message: "Entity " + cls.id.name + " must export " + createPropsName });
            continue;
          }

          var typeInfo = getCreatePropsTypeInfo(createProps.typeAnnotation);
          if (!typeInfo || typeInfo.sourceType !== propsName) {
            context.report({ node: createProps.id, message: createPropsName + " must be Omit<" + propsName + ", generated fields> so generated fields can be linted consistently" });
            continue;
          }

          var generatedKeys = getCreateGeneratedKeys(cls);
          if (generatedKeys.length === 0) continue;
          for (var go = 0; go < generatedKeys.length; go++) {
            var generatedOmitKey = generatedKeys[go];
            if (!typeInfo.fields.includes(generatedOmitKey)) {
              context.report({ node: createProps.id, message: createPropsName + " must omit generated field `" + generatedOmitKey + "`" });
            }
          }
        }
      },
    };
  },
};

// ─── Rule 12: no-raw-entity-serialization ─────────────────────────────────
var ENTITY_LIKE_NAMES = new Set([
  "category",
  "categories",
  "user",
  "users",
  "post",
  "posts",
  "media",
  "relationship",
  "relationships",
  "grant",
  "grants",
  "mirror",
  "mirrors",
  "item",
]);

function isToSnapshotCall(node) {
  return node &&
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    !node.callee.computed &&
    node.callee.property.type === "Identifier" &&
    node.callee.property.name === "toSnapshot";
}

function isEntityLikeExpression(node) {
  if (!node) return false;
  if (node.type === "Identifier") return ENTITY_LIKE_NAMES.has(node.name);
  if (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") {
    return ENTITY_LIKE_NAMES.has(node.property.name);
  }
  return false;
}

var noRawEntitySerializationRule = {
  meta: { type: "problem", docs: { description: "Domain entities must be serialized through toSnapshot()" } },
  create: function (context) {
    var filename = context.filename || context.physicalFilename || "";
    if (!/\/src\/(application|http)\//.test(filename)) return {};
    return {
      CallExpression: function (node) {
        if (node.callee.type !== "MemberExpression" || node.callee.computed) return;
        if (node.callee.property.type !== "Identifier" || node.callee.property.name !== "stringify") return;
        if (node.callee.object.type !== "Identifier" || node.callee.object.name !== "JSON") return;
        var firstArg = node.arguments[0];
        if (firstArg && !isToSnapshotCall(firstArg) && isEntityLikeExpression(firstArg)) {
          context.report({ node: firstArg, message: "Serialize domain entities with entity.toSnapshot() before JSON.stringify(...)" });
        }
      },

      SpreadElement: function (node) {
        if (isEntityLikeExpression(node.argument)) {
          context.report({ node: node, message: "Spread entity.toSnapshot(), not a domain entity instance" });
        }
      },
    };
  },
};

// ─── Rule 13: crud-adapter-jsdoc ──────────────────────────────────────────
var crudAdapterJSDocRule = {
  meta: { type: "problem", docs: { description: "CrudAdapter public methods need JSDoc" } },
  create: function (context) {
    var filename = context.filename || context.physicalFilename || "";
    if (!isCrudAdapter(filename)) return {};

    var crudClass = null;

    return {
      ClassDeclaration: function (node) {
        if (node.id && node.id.name === "CrudAdapter") {
          crudClass = node;
        }
      },
      "Program:exit": function () {
        if (!crudClass) return;
        var body = crudClass.body && crudClass.body.body;
        if (!body) return;
        for (var i = 0; i < body.length; i++) {
          var member = body[i];
          if (member.type !== "MethodDefinition") continue;
          if (member.key.type === "Identifier" && member.key.name === "constructor") continue;
          if (member.accessibility === "private") continue;
          if (!hasJSDoc(context, member)) {
            context.report({ node: member.key, message: "Every public CrudAdapter method must have JSDoc" });
          }
        }
      },
    };
  },
};

// ─── Rule 14: no-magic-numbers ────────────────────────────────────────────

function isSCREAMING_SNAKE(name) {
  return /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/.test(name);
}

function isConstDeclarator(node) {
  return node &&
    node.type === "VariableDeclarator" &&
    node.parent &&
    node.parent.type === "VariableDeclaration" &&
    node.parent.kind === "const";
}

function walkUpPastContainers(node) {
  var p = node.parent;
  while (p && (
    p.type === "UnaryExpression" ||
    p.type === "BinaryExpression" ||
    p.type === "LogicalExpression" ||
    p.type === "Property" ||
    p.type === "ObjectExpression" ||
    p.type === "ArrayExpression" ||
    p.type === "TSAsExpression" ||
    p.type === "TSSatisfiesExpression" ||
    p.type === "TSTypeAssertion"
  )) {
    p = p.parent;
  }
  return p;
}

function isAllowedConstLocation(filename) {
  return /\/src\/(shared|domain|infrastructure)\//.test(filename);
}

var noMagicNumbersRule = {
  meta: { type: "problem", docs: { description: "No magic numbers in application, domain, HTTP, and shared layers; extract to named constants" } },
  create: function (context) {
    var filename = context.filename || context.physicalFilename || "";
    if (!/\/src\/(application|domain|http|shared)\//.test(filename)) return {};
    if (/\/tests\//.test(filename)) return {};

    return {
      Literal: function (node) {
        if (typeof node.value !== "number") return;
        if (node.value === 0 || node.value === 1) return;

        if (node.parent && node.parent.type === "Property" && node.parent.key === node) return;
        if (node.parent && node.parent.type === "TSEnumMember" && node.parent.initializer === node) return;
        if (node.parent && (node.parent.type === "TSLiteralType" || node.parent.type === "TSTypeAnnotation")) return;

        var p = walkUpPastContainers(node);

        if (isConstDeclarator(p) && p.id && p.id.type === "Identifier" && isSCREAMING_SNAKE(p.id.name)) return;

        context.report({ node: node, message: "Magic number " + node.value + ". Extract to a named constant." });
      },
    };
  },
};

// ─── Rule 15: constants-placement ─────────────────────────────────────────

var constantsPlacementRule = {
  meta: { type: "problem", docs: { description: "SCREAMING_SNAKE_CASE const declarations must live in shared, domain, or infrastructure" } },
  create: function (context) {
    var filename = context.filename || context.physicalFilename || "";
    if (!/\/src\//.test(filename)) return {};
    if (/\/tests\//.test(filename)) return {};
    if (isAllowedConstLocation(filename)) return {};

    return {
      VariableDeclarator: function (node) {
        if (!isConstDeclarator(node)) return;
        if (!node.id || node.id.type !== "Identifier") return;
        if (!isSCREAMING_SNAKE(node.id.name)) return;
        context.report({ node: node.id, message: "Constant " + node.id.name + " must live in src/shared/, src/domain/, or src/infrastructure/" });
      },
    };
  },
};

// ─── Rule 16: constants-jsdoc ─────────────────────────────────────────────

function getTopLevelStatement(declarator) {
  var p = declarator.parent;
  if (!p) return null;
  if (p.type === "ExportNamedDeclaration") return p;
  if (p.parent && p.parent.type === "ExportNamedDeclaration") return p.parent;
  return p;
}

function isConstStatement(stmt) {
  if (stmt.type === "ExportNamedDeclaration") {
    return stmt.declaration && stmt.declaration.type === "VariableDeclaration" && stmt.declaration.kind === "const";
  }
  return stmt.type === "VariableDeclaration" && stmt.kind === "const";
}

function hasImmediateJSDoc(context, stmt) {
  var comments = context.sourceCode.getCommentsBefore(stmt);
  for (var i = 0; i < comments.length; i++) {
    var comment = comments[i];
    if (comment.value.charAt(0) !== "*") continue;
    if (comment.loc && stmt.loc && comment.loc.end.line < stmt.loc.start.line - 1) continue;
    return true;
  }
  return false;
}

function areAdjacentStatements(left, right) {
  return left.loc && right.loc && left.loc.end.line + 1 === right.loc.start.line;
}

function isInDocumentedGroup(context, declarator) {
  var stmt = getTopLevelStatement(declarator);
  if (!stmt || !stmt.parent || !stmt.parent.body) return false;

  var body = stmt.parent.body;
  var idx = -1;
  for (var i = 0; i < body.length; i++) {
    if (body[i] === stmt) { idx = i; break; }
  }
  if (idx <= 0) return false;

  for (var k = idx - 1; k >= 0; k--) {
    var prev = body[k];
    if (!isConstStatement(prev)) break;
    if (!areAdjacentStatements(prev, body[k + 1])) break;
    if (hasImmediateJSDoc(context, prev)) return true;
  }

  return false;
}

function hasConstDoc(context, declarator) {
  var stmt = getTopLevelStatement(declarator);
  if (!stmt) return false;
  if (hasImmediateJSDoc(context, stmt)) return true;
  if (isInDocumentedGroup(context, declarator)) return true;
  return false;
}

var constantsJSDocRule = {
  meta: { type: "problem", docs: { description: "SCREAMING_SNAKE_CASE constants must have JSDoc (direct or group)" } },
  create: function (context) {
    var filename = context.filename || context.physicalFilename || "";
    if (!/\/src\//.test(filename)) return {};
    if (/\/tests\//.test(filename)) return {};

    return {
      VariableDeclarator: function (node) {
        if (!isConstDeclarator(node)) return;
        if (!node.id || node.id.type !== "Identifier") return;
        if (!isSCREAMING_SNAKE(node.id.name)) return;

        // Only enforce in allowed const locations (shared, domain, infrastructure)
        if (!isAllowedConstLocation(filename)) return;

        if (!hasConstDoc(context, node)) {
          context.report({ node: node.id, message: "Constant " + node.id.name + " must have JSDoc (a /** group doc */ above a block of related constants, or a /** doc */ above each constant)" });
        }
      },
    };
  },
};

// ─── Plugin ───────────────────────────────────────────────────────────────
var plugin = {
  meta: { name: "architecture" },
  rules: {
    "layer-imports": layerImportsRule,
    "no-mapper-imports-outside-infra": noMapperImportsOutsideInfraRule,
    "no-storage-error-parsing": noStorageErrorParsingRule,
    "no-custom-errors-outside-shared": noCustomErrorsOutsideSharedRule,
    "req-valid-usage": reqValidUsageRule,
    "no-plain-zod-import": noPlainZodImportRule,
    "route-module": routeModuleRule,
    "route-handler-boundary": routeHandlerBoundaryRule,
    "repository-workflow": repositoryWorkflowRule,
    "mapper-file": mapperFileRule,
    "entity-class": entityClassRule,
    "no-raw-entity-serialization": noRawEntitySerializationRule,
    "crud-adapter-jsdoc": crudAdapterJSDocRule,
    "no-magic-numbers": noMagicNumbersRule,
    "constants-placement": constantsPlacementRule,
    "constants-jsdoc": constantsJSDocRule,
  },
};

export default plugin;
