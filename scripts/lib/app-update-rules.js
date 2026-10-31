// Additive, isolated patch, also used against the live rules with drift checks.
// No data migration and no change to access to other business collections.
export function addAppUpdateRules(source, target) {
  if (!['FA', 'FB'].includes(target)) throw Error('APP_UPDATE_RULE_TARGET');
  if (source.includes('// BEGIN_TARGETED_APP_UPDATES_V3')) return source;
  const replace = (from, to) => {
    if (source.split(from).length !== 2) throw Error('APP_UPDATE_RULE_ANCHOR');
    source = source.replace(from, () => to);
  };
  if (source.includes('// BEGIN_TARGETED_APP_UPDATES_V2')) {
    replace("d.keys().hasOnly(['uid', 'deviceId', 'target', 'platform', 'displayMode', 'loadedRelease', 'confirmedRequestId', 'lastSeenAt'])", "d.keys().hasOnly(['uid', 'deviceId', 'target', 'platform', 'displayMode', 'appVersion', 'loadedRelease', 'confirmedRequestId', 'lastSeenAt'])");
    replace("d.platform in ['Android', 'iOS', 'Windows', 'macOS', 'Outro'] &&", "(!d.keys().hasAny(['appVersion']) || (d.appVersion is string && d.appVersion.matches('^V[0-9]{1,3}[.][0-9]{1,6}$'))) &&\n            d.platform in ['Android', 'iOS', 'Windows', 'macOS', 'Outro'] &&");
    replace('// BEGIN_TARGETED_APP_UPDATES_V2', '// BEGIN_TARGETED_APP_UPDATES_V3');
    replace('// END_TARGETED_APP_UPDATES_V2', '// END_TARGETED_APP_UPDATES_V3');
    return source;
  }
  if (source.includes('// BEGIN_TARGETED_APP_UPDATES_V1')) {
    replace("d.keys().hasOnly(['uid', 'deviceId', 'target', 'platform', 'loadedRelease', 'confirmedRequestId', 'lastSeenAt'])", "d.keys().hasOnly(['uid', 'deviceId', 'target', 'platform', 'displayMode', 'loadedRelease', 'confirmedRequestId', 'lastSeenAt'])");
    replace("d.platform in ['Android', 'iOS', 'Windows', 'macOS', 'Outro'] &&", "(!d.keys().hasAny(['displayMode']) || d.displayMode in ['standalone', 'browser']) &&\n            d.platform in ['Android', 'iOS', 'Windows', 'macOS', 'Outro'] &&");
    replace('// BEGIN_TARGETED_APP_UPDATES_V1', '// BEGIN_TARGETED_APP_UPDATES_V2');
    replace('// END_TARGETED_APP_UPDATES_V1', '// END_TARGETED_APP_UPDATES_V2');
    return addAppUpdateRules(source,target);
  }
  if (source.includes('function firstLoginCohortDefaultOnCreate')) {
    replace("'updatedAt', 'firstLoginCohort'])", "'updatedAt', 'firstLoginCohort', 'appUpdateRequest'])");
    replace("!request.resource.data.diff(resource.data).affectedKeys().hasAny(['firstLoginCohort']);",
      "!request.resource.data.diff(resource.data).affectedKeys().hasAny(['firstLoginCohort', 'appUpdateRequest']);");
    replace('firstLoginCohortDefaultOnCreate(request.resource.data) &&',
      "firstLoginCohortDefaultOnCreate(request.resource.data) && !request.resource.data.keys().hasAny(['appUpdateRequest']) &&");
  } else {
    const fields = "data.keys().hasOnly(['uid', 'email', 'displayName', 'sigla', 'phone', 'active', 'access', 'role', 'permissions', 'createdAt', 'updatedAt'])";
    replace(fields, fields.replace("'updatedAt'])", "'updatedAt', 'appUpdateRequest'])"));
    replace("(!hasUserManagementPrivilege(request.resource.data) || isAdmin());\n      }",
      "(!hasUserManagementPrivilege(request.resource.data) || isAdmin()) &&\n          !request.resource.data.diff(resource.data).affectedKeys().hasAny(['appUpdateRequest']);\n      }");
    replace('allow create: if can(\'usersManage\') && validUserProfile(request.resource.data, uid) &&',
      "allow create: if can('usersManage') && validUserProfile(request.resource.data, uid) && !request.resource.data.keys().hasAny(['appUpdateRequest']) &&");
  }
  const block = `
    // BEGIN_TARGETED_APP_UPDATES_V3
    match /users/{uid} {
      function validAppUpdateRequest_() {
        let r = request.resource.data.appUpdateRequest;
        return r == null || (r is map &&
          r.keys().hasAll(['id', 'target', 'minimumRelease', 'requestedByUid', 'requestedAt']) &&
          r.keys().hasOnly(['id', 'target', 'minimumRelease', 'requestedByUid', 'requestedAt']) &&
          r.id is string && r.id.matches('^[a-zA-Z0-9_-]{16,80}$') && r.target == '${target}' &&
          r.minimumRelease is int && r.minimumRelease > 0 && r.minimumRelease <= 9007199254740991 &&
          r.requestedByUid == request.auth.uid && r.requestedAt == request.time);
      }
      allow update: if isAdmin() && request.resource.data.uid == uid &&
        request.resource.data.diff(resource.data).affectedKeys().hasOnly(['appUpdateRequest']) &&
        request.resource.data.keys().hasAny(['appUpdateRequest']) && validAppUpdateRequest_();
      match /appInstallations/{installation} {
        function validAppInstallation_() {
          let d = request.resource.data;
          let r = get(/databases/$(database)/documents/users/$(uid)).data.get('appUpdateRequest', null);
          return d.keys().hasAll(['uid', 'deviceId', 'target', 'platform', 'loadedRelease', 'confirmedRequestId', 'lastSeenAt']) &&
            d.keys().hasOnly(['uid', 'deviceId', 'target', 'platform', 'displayMode', 'appVersion', 'loadedRelease', 'confirmedRequestId', 'lastSeenAt']) &&
            d.uid == uid && d.deviceId is string && d.deviceId.matches('^[a-f0-9-]{36}$') &&
            installation == d.deviceId + '_${target}' && d.target == '${target}' &&
            (!d.keys().hasAny(['displayMode']) || d.displayMode in ['standalone', 'browser']) &&
            (!d.keys().hasAny(['appVersion']) || (d.appVersion is string && d.appVersion.matches('^V[0-9]{1,3}[.][0-9]{1,6}$'))) &&
            d.platform in ['Android', 'iOS', 'Windows', 'macOS', 'Outro'] &&
            d.loadedRelease is int && d.loadedRelease > 0 && d.loadedRelease <= 9007199254740991 &&
            d.lastSeenAt == request.time && d.confirmedRequestId is string &&
            (d.confirmedRequestId == '' || (r != null && d.confirmedRequestId == r.id && d.loadedRelease >= r.minimumRelease));
        }
        allow read: if activeUser() && (request.auth.uid == uid || isAdmin());
        allow create, update: if activeUser() && request.auth.uid == uid && validAppInstallation_();
        allow delete: if false;
      }
    }
    // END_TARGETED_APP_UPDATES_V3
`;
  replace('    match /users/{uid} {', block + '\n    match /users/{uid} {');
  return source;
}
