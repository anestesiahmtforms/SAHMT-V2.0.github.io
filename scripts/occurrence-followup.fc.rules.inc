    function occurrenceCounterPath() {
      return /databases/$(database)/documents/occurrenceSequences/app;
    }
    function occurrenceFollowupPath(id) {
      return /databases/$(database)/documents/occurrenceFollowups/$(id);
    }
    function occurrenceHospitalAuditPath(id) {
      return /databases/$(database)/documents/occurrenceHospitalAudit/$(id);
    }
    function occurrenceGrantPath(uid) {
      return /databases/$(database)/documents/occurrenceHospitalGrants/$(uid);
    }
    function occurrenceAdministrator() {
      return activeUser() && (profile().get('role','') == 'administrador_app' || profileCan('admin'));
    }
    function canRegisterHospitalOccurrence() {
      return occurrenceAdministrator() || (activeUser() && exists(occurrenceGrantPath(request.auth.uid)) &&
        get(occurrenceGrantPath(request.auth.uid)).data.enabled == true);
    }
    function canEditOccurrenceDescription() {
      let grant = /databases/$(database)/documents/occurrenceDescriptionGrants/$(request.auth.uid);
      return occurrenceAdministrator() || (activeUser() && exists(grant) && get(grant).data.enabled == true);
    }
    function validOccurrenceNumber(id, data) {
      let counter = getAfter(occurrenceCounterPath()).data;
      let entry = getAfter(occurrenceFollowupPath(id)).data;
      return data.sequence is int && data.sequence > 0 && counter.last == data.sequence && counter.reportId == id &&
        entry.id == id && entry.origin == 'app' && entry.sequence == data.sequence && entry.createdAt == request.time;
    }
    function validOccurrenceCounter(data, next) {
      let report = getAfter(reportPath(data.reportId)).data;
      return data.keys().hasOnly(['last','reportId']) && data.last is int && data.last == next &&
        data.reportId is string && data.reportId.matches('^[A-Fa-f0-9-]{36}$') &&
        !exists(reportPath(data.reportId)) && report.createdAt == request.time && report.sequence == data.last;
    }
    match /occurrenceSequences/app {
      allow get: if canWrite() && fcRecordsFolderOpen_('registros/ocorrencias');
      allow create: if canWrite() && fcRecordsFolderOpen_('registros/ocorrencias') && validOccurrenceCounter(request.resource.data,1);
      allow update: if canWrite() && fcRecordsFolderOpen_('registros/ocorrencias') && validOccurrenceCounter(request.resource.data,resource.data.last+1);
      allow list, delete: if false;
    }
    function occurrenceText(value,max) {
      return value is string && value.size() > 0 && value.size() <= max && value.matches('(?s).*\\S.*');
    }
    function validOccurrenceAppFields(data) {
      let fields = data.details;
      let classification = data.classification;
      return OCCURRENCE_FOLLOWUP_FORM_FIELDS;
    }
    function validOccurrenceFollowup(id,data) {
      return data.keys().hasAll(['schemaVersion','id','origin','formId','occurredOn','title','description','classification','details','createdAt']) &&
        data.keys().hasOnly(['schemaVersion','id','origin','formId','occurredOn','title','description','classification','details','createdAt','sequence','hospitalNumber']) &&
        data.schemaVersion == 1 && data.id == id &&
        data.formId in ['F01','F02','F03','F04','F05','F06','F07','F08','F09','F10'] &&
        data.classification is map && data.details is map &&
        (data.origin == 'hospital' ? data.classification.size() == 0 && data.details.size() == 0 : validOccurrenceAppFields(data)) &&
        data.createdAt == request.time &&
        (data.origin == 'app' && data.formId == 'F10' ?
          data.occurredOn == null && data.title == null && data.description == null :
          data.occurredOn is string && data.occurredOn.matches('^\\d{4}-\\d{2}-\\d{2}$') &&
          occurrenceText(data.title,180) && occurrenceText(data.description,5000));
    }
    function validAppOccurrenceFollowup(id,data) {
      let report = getAfter(reportPath(id)).data;
      return data.origin == 'app' && !data.keys().hasAny(['hospitalNumber']) &&
        report.createdAt == request.time && report.sequence == data.sequence && report.formId == data.formId &&
        report.occurredOn == data.occurredOn && getAfter(auditPath(id)).data.uid == request.auth.uid;
    }
    function validHospitalOccurrenceFollowup(id,data) {
      return data.origin == 'hospital' && !data.keys().hasAny(['sequence']) &&
        data.hospitalNumber is string && data.hospitalNumber.matches('^[1-9][0-9]{0,11}$') &&
        id == 'gr-' + data.hospitalNumber &&
        getAfter(occurrenceHospitalAuditPath(id)).data.createdAt == request.time;
    }
    function validOccurrenceAnalysis(data) {
      let analysis = data.analysis;
      return data.keys().hasOnly(['analysis','updatedAt']) && data.updatedAt == request.time &&
        analysis is map && analysis.keys().hasOnly(['problem','cause','review','correction','plan']) &&
        occurrenceText(analysis.problem,3000) && occurrenceText(analysis.cause,3000) &&
        occurrenceText(analysis.review,3000) && occurrenceText(analysis.correction,3000) && occurrenceText(analysis.plan,3000);
    }
    match /occurrenceFollowups/{id} {
      allow get: if activeUser();
      allow list: if activeUser() && request.query.limit != null && request.query.limit <= 30;
      allow create: if fcRecordsFolderOpen_('registros/ocorrencias') && validOccurrenceFollowup(id,request.resource.data) &&
        ((request.resource.data.origin == 'app' && canWrite() && validAppOccurrenceFollowup(id,request.resource.data)) ||
          (request.resource.data.origin == 'hospital' && canRegisterHospitalOccurrence() && validHospitalOccurrenceFollowup(id,request.resource.data)));
      allow update: if canEditOccurrenceDescription() &&
        request.resource.data.diff(resource.data).affectedKeys().hasOnly(['description']) &&
        occurrenceText(request.resource.data.description,5000);
      allow delete: if false;
      match /analyses/{uid} {
        allow get: if activeUser() && (request.auth.uid == uid || occurrenceAdministrator());
        allow list: if occurrenceAdministrator() && request.query.limit != null && request.query.limit <= 30;
        allow create, update: if activeUser() && request.auth.uid == uid && fcRecordsFolderOpen_('registros/ocorrencias') &&
          get(occurrenceFollowupPath(id)).data.formId != 'F08' && validOccurrenceAnalysis(request.resource.data);
        allow delete: if false;
      }
      match /ethicalReview/current {
        allow get: if canEditOccurrenceDescription() && get(occurrenceFollowupPath(id)).data.formId == 'F08';
        allow create, update: if canEditOccurrenceDescription() && get(occurrenceFollowupPath(id)).data.formId == 'F08' &&
          request.resource.data.keys().hasOnly(['text','updatedAt']) &&
          request.resource.data.text is string && request.resource.data.text.size() <= 20000 &&
          request.resource.data.updatedAt == request.time;
        allow delete: if false;
      }
    }
    match /occurrenceHospitalAudit/{id} {
      allow get: if canAudit() || occurrenceAdministrator();
      allow create: if fcRecordsFolderOpen_('registros/ocorrencias') && canRegisterHospitalOccurrence() &&
        request.resource.data.keys().hasOnly(['uid','createdAt']) && request.resource.data.uid == request.auth.uid &&
        request.resource.data.createdAt == request.time && getAfter(occurrenceFollowupPath(id)).data.createdAt == request.time &&
        getAfter(occurrenceFollowupPath(id)).data.origin == 'hospital';
      allow list, update, delete: if false;
    }
    match /occurrenceHospitalGrants/{uid} {
      allow get: if activeUser() && (request.auth.uid == uid || occurrenceAdministrator());
      allow create, update: if occurrenceAdministrator() && request.resource.data.keys().hasOnly(['enabled','updatedAt','updatedBy']) &&
        request.resource.data.enabled is bool && request.resource.data.updatedAt == request.time && request.resource.data.updatedBy == request.auth.uid;
      allow list, delete: if false;
    }
    match /occurrenceDescriptionGrants/{uid} {
      allow get: if activeUser() && (request.auth.uid == uid || occurrenceAdministrator());
      allow create, update: if occurrenceAdministrator() && request.resource.data.keys().hasOnly(['enabled','updatedAt','updatedBy']) &&
        request.resource.data.enabled is bool && request.resource.data.updatedAt == request.time && request.resource.data.updatedBy == request.auth.uid;
      allow list, delete: if false;
    }

