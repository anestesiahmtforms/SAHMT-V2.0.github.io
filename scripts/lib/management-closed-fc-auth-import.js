// FC-specific, offline batch preparation and reconciliation surface.
// This module has no Firebase SDK, credentials, network client or write path.
export {
  prepareManagementClosedFcAuthImport,
  validateManagementClosedAuthImportResponse as validateManagementClosedFcAuthImportResponse,
  validateManagementClosedAuthImportPostcheck as validateManagementClosedFcAuthImportPostcheck,
  managementClosedAuthImportRequestDigest as managementClosedFcAuthImportRequestDigest
} from './management-closed-auth-import.js';
