    function occurrenceCounterPath() {
      return /databases/$(database)/documents/occurrenceSequences/app;
    }
    function occurrenceFollowupPath(id) {
      return /databases/$(database)/documents/occurrenceFollowups/$(id);
    }
    function occurrenceResultPath(id) {
      return /databases/$(database)/documents/occurrenceFollowups/$(id)/ethicalPollResult/current;
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
      let permissions = profile().get('permissions',{});
      return activeUser() && (profile().get('role','') == 'administrador_app' ||
        (permissions is map && permissions.get('admin',false) == true) ||
        (exists(grant) && get(grant).data.enabled == true));
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
      return value is string && value.size() <= max && value.matches('(?s).*\\S.*');
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
      allow update: if canEditOccurrenceDescription() && (
        (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['preparedDescription']) &&
          resource.data.get('analysisStarted',false) && !resource.data.get('analysisClosed',false) &&
          resource.data.get('responsesClosedAt',null) == null && occurrenceText(request.resource.data.preparedDescription,5000)) ||
        (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['analysisStarted','preparedDescription']) &&
          !resource.data.get('analysisStarted',false) && request.resource.data.analysisStarted == true &&
          !resource.data.get('analysisClosed',false) && occurrenceText(request.resource.data.preparedDescription,5000) &&
          getAfter(occurrenceQuestionnairePath(id)).data.publishedAt == request.time) ||
        (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['responsesClosedAt']) &&
          resource.data.get('analysisStarted',false) && !resource.data.get('analysisClosed',false) &&
          resource.data.get('responsesClosedAt',null) == null && request.resource.data.responsesClosedAt == request.time) ||
        (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['analysisClosed']) &&
          request.resource.data.analysisClosed == true &&
          !resource.data.get('eventClosed',false) && getAfter(occurrenceResultPath(id)).data.updatedAt == request.time) ||
        (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['eventClosed']) &&
          request.resource.data.eventClosed == true && resource.data.get('analysisClosed',false) &&
          exists(occurrenceResultPath(id)))
      );
      allow delete: if false;
      match /preparationContext/current {
        allow get: if canEditOccurrenceDescription();
        allow create: if canWrite() && !exists(reportPath(id)) &&
          getAfter(occurrenceFollowupPath(id)).data.origin == 'app' &&
          getAfter(auditPath(id)).data.uid == request.auth.uid &&
          request.resource.data.keys().hasOnly(['fields']) &&
          request.resource.data.fields is map &&
          request.resource.data.fields.size() > 0 &&
          request.resource.data.fields.keys().hasOnly(['immediateAction','chartDisclosure','analysisParticipants','patientFactors','taskFactors',
            'individualFactors','teamFactors','workEnvironmentFactors','informationTechnologyFactors']) &&
          request.resource.data.fields.diff(getAfter(reportPath(id)).data.details.actionFollowup).affectedKeys().hasOnly(['immediateAction']) &&
          request.resource.data.fields.get('analysisParticipants','Serviço de Anestesiologia') == 'Serviço de Anestesiologia' &&
          (!request.resource.data.fields.keys().hasAny(['immediateAction']) ||
            (getAfter(reportPath(id)).data.formId == 'F02' && occurrenceText(request.resource.data.fields.immediateAction,3000)));
        allow list, update, delete: if false;
      }
      match /analyses/{uid} {
        allow get: if activeUser() && (request.auth.uid == uid || occurrenceAdministrator());
        allow list: if canEditOccurrenceDescription() && request.query.limit != null && request.query.limit <= 30;
        allow create, update: if activeUser() && request.auth.uid == uid && fcRecordsFolderOpen_('registros/ocorrencias') &&
          get(occurrenceFollowupPath(id)).data.get('responsesClosedAt',null) == null &&
          !get(occurrenceFollowupPath(id)).data.get('analysisClosed',false) &&
          get(occurrenceFollowupPath(id)).data.formId != 'F08' && !exists(occurrenceQuestionnairePath(id)) && validOccurrenceAnalysis(request.resource.data);
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
      match /analysisQuestionnaire/current {
        allow get: if activeUser() && exists(occurrenceFollowupPath(id));
        allow create: if canEditOccurrenceDescription() && exists(occurrenceFollowupPath(id)) &&
          !get(occurrenceFollowupPath(id)).data.get('analysisClosed',false) &&
          getAfter(occurrenceFollowupPath(id)).data.get('analysisStarted',false) && validOccurrenceQuestionnaire(id,request.resource.data);
        allow update, delete: if false;
      }
      match /ethicalPollResponses/{uid} {
        allow get: if activeUser() && request.auth.uid == uid && exists(occurrenceFollowupPath(id));
        allow list: if canEditOccurrenceDescription() && request.query.limit != null && request.query.limit <= 30;
        allow create: if activeUser() && request.auth.uid == uid && fcRecordsFolderOpen_('registros/ocorrencias') &&
          exists(occurrenceFollowupPath(id)) && !getAfter(occurrenceFollowupPath(id)).data.get('analysisClosed',false) &&
          getAfter(occurrenceFollowupPath(id)).data.get('responsesClosedAt',null) == null && validOccurrenceResponse(id,request.resource.data);
        allow update, delete: if false;
      }
      match /ethicalPollResult/current {
        allow get: if activeUser() && (canEditOccurrenceDescription() ||
          get(occurrenceFollowupPath(id)).data.get('analysisClosed',false));
        allow create, update: if canEditOccurrenceDescription() && exists(occurrenceFollowupPath(id)) &&
          (get(occurrenceFollowupPath(id)).data.get('analysisClosed',false) ||
            get(occurrenceFollowupPath(id)).data.get('responsesClosedAt',null) is timestamp) &&
          !get(occurrenceFollowupPath(id)).data.get('eventClosed',false) &&
          getAfter(occurrenceFollowupPath(id)).data.analysisClosed == true &&
          request.resource.data.keys().hasOnly(['text','updatedAt']) &&
          occurrenceText(request.resource.data.text,20000) && request.resource.data.updatedAt == request.time;
        allow delete: if false;
      }
      match /analysisAcknowledgements/{uid} {
        allow get: if activeUser() && request.auth.uid == uid && exists(occurrenceFollowupPath(id));
        allow create, update: if activeUser() && request.auth.uid == uid &&
          get(occurrenceFollowupPath(id)).data.get('analysisClosed',false) &&
          request.resource.data.keys().hasOnly(['resultAt','acknowledgedAt']) &&
          request.resource.data.resultAt == get(occurrenceResultPath(id)).data.updatedAt &&
          request.resource.data.acknowledgedAt == request.time &&
          (resource == null || resource.data.resultAt != request.resource.data.resultAt);
        allow list, delete: if false;
      }
    }
    function newOccurrenceScoreEvidence(id, subcollection, timeField) {
      let event = /databases/$(database)/documents/occurrenceFollowups/$(id)/$(subcollection)/$(request.auth.uid);
      return !exists(event) && getAfter(event).data[timeField] == request.time;
    }
    function validParticipationScore(claimId, data) {
      return data.keys().hasOnly(['schemaVersion','id','source','sourceId','uid','points','status','createdAt']) &&
        data.schemaVersion == 1 && data.id == claimId && data.uid == request.auth.uid &&
        data.sourceId is string && data.sourceId.matches('^([A-Fa-f0-9-]{36}|gr-[1-9][0-9]{0,11})$') &&
        data.points == 1 && data.status == 'PENDING_VALIDATION' && data.createdAt == request.time &&
        ((data.source == 'ANALISE_OCORRENCIA' && claimId == 'analysis-'+data.sourceId+'_'+request.auth.uid &&
          newOccurrenceScoreEvidence(data.sourceId,'ethicalPollResponses','submittedAt')) ||
         (data.source == 'CIENCIA_OCORRENCIA' && claimId == 'ack-'+data.sourceId+'_'+request.auth.uid &&
          newOccurrenceScoreEvidence(data.sourceId,'analysisAcknowledgements','acknowledgedAt')));
    }
    match /occurrenceScoreClaims/{claimId} {
      allow get: if activeUser() && resource.data.uid == request.auth.uid &&
        resource.data.source in ['ANALISE_OCORRENCIA','CIENCIA_OCORRENCIA'];
      allow create: if activeUser() && validParticipationScore(claimId,request.resource.data);
    }
    function occurrenceQuestionnairePath(id) {
      return /databases/$(database)/documents/occurrenceFollowups/$(id)/analysisQuestionnaire/current;
    }
    function validOccurrenceQuestion(question) {
      let options = question.options;
      return question is map && question.keys().hasOnly(['prompt','options']) &&
        occurrenceText(question.prompt,OCCURRENCE_PROMPT_LIMIT) &&
        options is list && options.size() >= 2 && options.size() <= OCCURRENCE_OPTION_LIMIT &&
        OCCURRENCE_OPTION_CHECKS;
    }
    function validSafetyQuestion(question) {
      let options = question.options;
      // Keep the question shape and answer bounds within the ten-question evaluation budget.
      // The app also normalizes each option's text on publication and on read.
      return question.keys().hasOnly(['prompt','options']) &&
        question.prompt is string &&
        options is list && options.size() >= 2 && options.size() <= OCCURRENCE_OPTION_LIMIT;
    }
    function validOccurrenceQuestionnaire(id,data) {
      let questions = data.questions;
      let ethical = getAfter(occurrenceFollowupPath(id)).data.formId == 'F08';
      return data.keys().hasOnly(['questions','publishedAt']) && data.publishedAt == request.time && questions is list &&
        (ethical ? (questions.size() == OCCURRENCE_QUESTION_COUNT && OCCURRENCE_QUESTION_CHECKS) :
          validSafetyQuestionnaire(questions));
    }
    function validSafetyQuestionnaire(questions) {
      return questions.size() >= OCCURRENCE_SAFETY_MIN_QUESTIONS && questions.size() <= OCCURRENCE_SAFETY_MAX_QUESTIONS &&
        OCCURRENCE_SAFETY_QUESTION_CHECKS &&
        questions[questions.size()-1].options.size() <= OCCURRENCE_IMPROVEMENT_OPTION_LIMIT;
    }
    function validOccurrenceResponse(id,data) {
      let answers = data.answers;
      let questionnaire = get(occurrenceQuestionnairePath(id)).data;
      let questions = questionnaire.questions;
      return data.keys().hasOnly(['answers','comment','submittedAt','questionnaireRevision']) &&
        data.get('questionnaireRevision',0) == questionnaire.get('revision',0) &&
        answers is list && answers.size() == questions.size() &&
        answers.size() >= OCCURRENCE_QUESTION_COUNT && answers.size() <= OCCURRENCE_SAFETY_MAX_QUESTIONS &&
        OCCURRENCE_ANSWER_CHECKS &&
        data.comment is string && data.comment.size() <= OCCURRENCE_COMMENT_LIMIT &&
        data.submittedAt == request.time;
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

