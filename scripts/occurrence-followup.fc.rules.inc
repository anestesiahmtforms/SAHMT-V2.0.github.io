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
    function canManageOccurrence(id) {
      return id.matches('^gr-[1-9][0-9]{0,11}$') ? canEditOccurrenceDescription() : occurrenceAdministrator();
    }
    function occurrenceCardPath(id) {
      return /databases/$(database)/documents/occurrenceAnalysisCards/$(id);
    }
    function occurrenceResultDraftPath(id) {
      return /databases/$(database)/documents/occurrenceFollowups/$(id)/analysisResultDraft/current;
    }
    function validOccurrenceCard(id, card, entry) {
      let opened = entry.get('analysisStarted',false);
      let published = entry.get('analysisClosed',false);
      return entry.origin == 'app' && card.id == id && card.origin == 'app' &&
        card.formId == entry.formId && card.sequence == entry.sequence &&
        card.analysisStarted == opened && card.analysisClosed == published &&
        card.responsesClosedAt == (entry.get('responsesClosedAt',null) != null) &&
        card.preparedDescription == (opened ? entry.get('preparedDescription','') : '') &&
        card.keys().hasOnly(['id','origin','formId','sequence','analysisStarted','responsesClosedAt','analysisClosed','preparedDescription','resultAt']) &&
        (published ? card.resultAt == getAfter(occurrenceResultPath(id)).data.updatedAt :
          !card.keys().hasAny(['resultAt']));
    }
    function occurrenceCardMatches(id, entry) {
      return entry.origin == 'hospital' || validOccurrenceCard(id,getAfter(occurrenceCardPath(id)).data,entry);
    }
    match /occurrenceAnalysisCards/{id} {
      allow get: if activeUser();
      allow list: if activeUser() && request.query.limit != null && request.query.limit <= 30;
      allow create: if canWrite() && getAfter(occurrenceFollowupPath(id)).data.createdAt == request.time &&
        validOccurrenceCard(id,request.resource.data,getAfter(occurrenceFollowupPath(id)).data);
      allow update: if occurrenceAdministrator() &&
        validOccurrenceCard(id,request.resource.data,getAfter(occurrenceFollowupPath(id)).data);
      allow delete: if false;
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
        data.details.get('eventClassification','') in OCCURRENCE_EVENT_CLASSIFICATIONS &&
        report.details.get('eventClassification','') == data.details.eventClassification &&
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
      allow get: if activeUser() && (id.matches('^gr-[1-9][0-9]{0,11}$') || occurrenceAdministrator());
      allow list: if activeUser() && (resource.data.origin == 'hospital' || occurrenceAdministrator()) &&
        request.query.limit != null && request.query.limit <= 30;
      allow create: if fcRecordsFolderOpen_('registros/ocorrencias') && validOccurrenceFollowup(id,request.resource.data) &&
        occurrenceCardMatches(id,request.resource.data) &&
        ((request.resource.data.origin == 'app' && canWrite() && validAppOccurrenceFollowup(id,request.resource.data)) ||
          (request.resource.data.origin == 'hospital' && canRegisterHospitalOccurrence() && validHospitalOccurrenceFollowup(id,request.resource.data)));
      allow update: if canManageOccurrence(id) && occurrenceCardMatches(id,request.resource.data) && (
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
        allow get: if canManageOccurrence(id);
        allow create: if canWrite() && !exists(reportPath(id)) &&
          getAfter(occurrenceFollowupPath(id)).data.origin == 'app' &&
          getAfter(auditPath(id)).data.uid == request.auth.uid &&
          request.resource.data.keys().hasOnly(['fields','clinical','attendance']) &&
          request.resource.data.fields is map &&
          request.resource.data.fields.size() > 0 &&
          request.resource.data.fields.keys().hasOnly(['immediateAction','chartDisclosure','analysisParticipants','patientFactors','taskFactors',
            'individualFactors','teamFactors','workEnvironmentFactors','informationTechnologyFactors']) &&
          request.resource.data.fields.diff(getAfter(reportPath(id)).data.details.actionFollowup).affectedKeys().hasOnly(['immediateAction']) &&
          request.resource.data.fields.get('analysisParticipants','Serviço de Anestesiologia') == 'Serviço de Anestesiologia' &&
          validOccurrenceAnalysisClinical(request.resource.data.get('clinical',{})) &&
          (!request.resource.data.keys().hasAny(['attendance']) ||
            validOccurrenceAnalysisAttendance(id,request.resource.data.attendance)) &&
          (!request.resource.data.fields.keys().hasAny(['immediateAction']) ||
            (getAfter(reportPath(id)).data.formId == 'F02' && occurrenceText(request.resource.data.fields.immediateAction,3000)));
        allow list, update, delete: if false;
      }
      match /analyses/{uid} {
        allow get: if activeUser() && (request.auth.uid == uid || occurrenceAdministrator());
        allow list: if canManageOccurrence(id) && request.query.limit != null && request.query.limit <= 30;
        allow create, update: if activeUser() && request.auth.uid == uid && fcRecordsFolderOpen_('registros/ocorrencias') &&
          get(occurrenceFollowupPath(id)).data.origin == 'hospital' &&
          get(occurrenceFollowupPath(id)).data.get('responsesClosedAt',null) == null &&
          !get(occurrenceFollowupPath(id)).data.get('analysisClosed',false) &&
          get(occurrenceFollowupPath(id)).data.formId != 'F08' && !exists(occurrenceQuestionnairePath(id)) && validOccurrenceAnalysis(request.resource.data);
        allow delete: if false;
      }
      match /ethicalReview/current {
        allow get: if canManageOccurrence(id) && get(occurrenceFollowupPath(id)).data.formId == 'F08';
        allow create, update: if canManageOccurrence(id) && get(occurrenceFollowupPath(id)).data.formId == 'F08' &&
          request.resource.data.keys().hasOnly(['text','updatedAt']) &&
          request.resource.data.text is string && request.resource.data.text.size() <= 20000 &&
          request.resource.data.updatedAt == request.time;
        allow delete: if false;
      }
      match /analysisQuestionnaire/current {
        allow get: if activeUser() && (canManageOccurrence(id) ||
          get(occurrenceFollowupPath(id)).data.get('analysisStarted',false) ||
          get(occurrenceFollowupPath(id)).data.origin == 'hospital');
        allow create: if canManageOccurrence(id) && exists(occurrenceFollowupPath(id)) &&
          !get(occurrenceFollowupPath(id)).data.get('analysisClosed',false) &&
          getAfter(occurrenceFollowupPath(id)).data.get('analysisStarted',false) && validOccurrenceQuestionnaire(id,request.resource.data);
        allow update: if resource.data.get('canRevise',false) && resource.data.get('lockedAt',null) == null &&
          (validOccurrenceQuestionLock(id) ||
            (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['questions','revision']) &&
              canManageOccurrence(id) && get(occurrenceFollowupPath(id)).data.get('analysisStarted',false) &&
              !getAfter(occurrenceFollowupPath(id)).data.get('analysisClosed',false) &&
              getAfter(occurrenceFollowupPath(id)).data.get('responsesClosedAt',null) == null &&
              request.resource.data.revision == resource.data.get('revision',0)+1 &&
              validOccurrenceQuestionItems(id,request.resource.data.questions)));
        allow delete: if false;
      }
      match /ethicalPollResponses/{uid} {
        allow get: if activeUser() && request.auth.uid == uid && exists(occurrenceFollowupPath(id));
        allow list: if canManageOccurrence(id) && request.query.limit != null && request.query.limit <= 30;
        allow create: if activeUser() && request.auth.uid == uid && fcRecordsFolderOpen_('registros/ocorrencias') &&
          exists(occurrenceFollowupPath(id)) && !getAfter(occurrenceFollowupPath(id)).data.get('analysisClosed',false) &&
          (id.matches('^gr-[1-9][0-9]{0,11}$') || getAfter(occurrenceFollowupPath(id)).data.get('analysisStarted',false)) &&
          getAfter(occurrenceFollowupPath(id)).data.get('responsesClosedAt',null) == null && validOccurrenceResponse(id,request.resource.data);
        allow update, delete: if false;
      }
      match /ethicalPollResult/current {
        allow get: if activeUser() && (canManageOccurrence(id) ||
          get(occurrenceFollowupPath(id)).data.get('analysisClosed',false));
        allow create, update: if canManageOccurrence(id) && exists(occurrenceFollowupPath(id)) &&
          (get(occurrenceFollowupPath(id)).data.get('analysisClosed',false) ||
            get(occurrenceFollowupPath(id)).data.get('responsesClosedAt',null) is timestamp) &&
          !get(occurrenceFollowupPath(id)).data.get('eventClosed',false) &&
          getAfter(occurrenceFollowupPath(id)).data.analysisClosed == true &&
          (id.matches('^gr-[1-9][0-9]{0,11}$') ||
            (!get(occurrenceFollowupPath(id)).data.get('analysisClosed',false) &&
              request.resource.data.diff(get(occurrenceResultDraftPath(id)).data).affectedKeys().hasOnly(['updatedAt']))) &&
          validOccurrenceResultText(request.resource.data);
        allow delete: if false;
      }
      match /analysisResultDraft/current {
        allow get: if occurrenceAdministrator();
        allow create, update: if occurrenceAdministrator() && get(occurrenceFollowupPath(id)).data.origin == 'app' &&
          get(occurrenceFollowupPath(id)).data.get('responsesClosedAt',null) is timestamp &&
          !get(occurrenceFollowupPath(id)).data.get('analysisClosed',false) && validOccurrenceResultText(request.resource.data);
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
    function validOccurrenceResultText(data) {
      let date = data.get('dueDate','2000-01-01');
      return data.keys().hasOnly(['text','updatedAt','dueDate']) && date is string &&
        date.matches('^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$') &&
        occurrenceText(data.text,20000) && data.updatedAt == request.time;
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
    function validOccurrenceAnalysisClinical(clinical) {
      return clinical is map && clinical.keys().hasOnly(['age','sex','diagnosisOrTreatment']) &&
        occurrenceText(clinical.get('age','—'),40) &&
        occurrenceText(clinical.get('sex','—'),12) &&
        occurrenceText(clinical.get('diagnosisOrTreatment','—'),3000);
    }
    function validOccurrenceAnalysisAttendance(id,attendance) {
      let report = getAfter(reportPath(id)).data;
      return occurrenceText(attendance,180) &&
        attendance == report.details.get('attendance',report.classification.get('patientOrAttendance',''));
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
      return data.keys().hasOnly(['questions','publishedAt','canRevise']) && data.publishedAt == request.time &&
        data.get('canRevise',false) is bool && validOccurrenceQuestionItems(id,data.questions);
    }
    function validOccurrenceQuestionItems(id,questions) {
      let ethical = getAfter(occurrenceFollowupPath(id)).data.formId == 'F08';
      return questions is list &&
        (ethical ? (questions.size() == OCCURRENCE_QUESTION_COUNT && OCCURRENCE_QUESTION_CHECKS) :
          validSafetyQuestionnaire(questions));
    }
    function validOccurrenceQuestionLock(id) {
      let response = /databases/$(database)/documents/occurrenceFollowups/$(id)/ethicalPollResponses/$(request.auth.uid);
      return request.resource.data.diff(resource.data).affectedKeys().hasOnly(['lockedAt']) &&
        activeUser() && request.resource.data.lockedAt == request.time &&
        !exists(response) && getAfter(response).data.submittedAt == request.time;
    }
    function validSafetyQuestionnaire(questions) {
      return questions.size() >= OCCURRENCE_SAFETY_MIN_QUESTIONS && questions.size() <= OCCURRENCE_SAFETY_MAX_QUESTIONS &&
        OCCURRENCE_SAFETY_QUESTION_CHECKS &&
        questions[questions.size()-1].options.size() <= OCCURRENCE_IMPROVEMENT_OPTION_LIMIT;
    }
    function validOccurrenceResponse(id,data) {
      let answers = data.answers;
      let questionnaire = getAfter(occurrenceQuestionnairePath(id)).data;
      let questions = questionnaire.questions;
      return data.keys().hasOnly(['answers','comment','submittedAt','questionnaireRevision']) &&
        (!questionnaire.get('canRevise',false) || questionnaire.get('lockedAt',null) is timestamp) &&
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

