export interface ContentPrincipalDirectory {
  validateUser(params: { userId: string }): Promise<void>;
  validateUserInOrganization(params: { userId: string; orgId: string }): Promise<void>;
  validateTeamInOrganization(params: { teamId: string; orgId: string }): Promise<void>;
  validateServiceAccountForOrganization(params: { clientId: string; orgId: string; resource: string }): Promise<void>;
  validateOrganizationAdministrator(params: { userId: string; orgId: string }): Promise<void>;
}
