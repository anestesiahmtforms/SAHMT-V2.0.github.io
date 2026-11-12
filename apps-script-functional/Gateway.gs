/** Standalone FK writer and FA-authorized same-UID token bridge. */
var FK_PROJECT_ = 'sahmt-funcional-fk';
var FA_PROJECT_ = 'sahmt-17a16';
var FA_API_KEY_ = 'AIzaSyDg7plEPhaIieyDP3z462gxG9cY_OQCzvA';
var FK_API_KEY_ = 'AIzaSyAFlbjIqKzfwEnZgyMOIveNsp4I4Wbf7QM';
var FK_SIGNER_ = 'fk-functional-token-signer@sahmt-funcional-fk.iam.gserviceaccount.com';
var FK_ALLOWED_SOURCES_ = ['performance','professionalRegistration','epidemiological','fe','climateSurvey',
  'stressFatigue','biosafetyManual','vaccination','dosimetry'];
var FK_AUTH_AUDIENCE_ = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';
var FK_ADMIN_EMAIL_ = 'wx2064@gmail.com';
var FK_MANAGER_EMAIL_ = 'marcio.henrique82@gmail.com';

function doPost(event) {
  try {
    var envelope = JSON.parse((event && event.postData && event.postData.contents) || '{}');
    var payload = verifyEnvelope_(envelope);
    if (payload.action === 'AUTH_SESSION') return json_(authorizeFaUser_(payload.faIdToken));
    if (payload.action === 'SYNC_OVERVIEW') return json_(syncOwnOverview_(payload.faIdToken));
    if (payload.action === 'FUNCTIONAL_SURVEY_SUBMIT') return json_(submitFunctionalSurvey_(payload));
    throw new Error('FK_ACTION_INVALID');
  } catch (error) {
    return json_({ code: /^FK_[A-Z0-9_]+$/.test(String(error && error.message)) ? String(error.message) : 'FK_REQUEST_UNAVAILABLE' });
  }
}

function authorizeFaUser_(idToken, issueToken) {
  if (issueToken === undefined) issueToken = true;
  if (typeof idToken !== 'string' || idToken.length < 100 || idToken.length > 10000) throw new Error('FK_AUTH_DENIED');
  var identityResponse = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FA_API_KEY_, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true
  });
  if (identityResponse.getResponseCode() !== 200) throw new Error('FK_AUTH_DENIED');
  var identity = JSON.parse(identityResponse.getContentText()).users;
  if (!Array.isArray(identity) || identity.length !== 1) throw new Error('FK_AUTH_DENIED');
  var authUser = identity[0], uid = authUser.localId, email = normalizeEmail_(authUser.email);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid || '') || !email || authUser.emailVerified !== true || authUser.disabled === true)
    throw new Error('FK_AUTH_DENIED');

  var profile = readFaDocument_(idToken, 'users/' + uid);
  if (!profile || profile.uid !== uid || normalizeEmail_(profile.email) !== email || profile.active !== true || profile.access !== true)
    throw new Error('FK_AUTH_DENIED');

  var claims, group;
  if (email === FK_ADMIN_EMAIL_) {
    group = 'ADMINISTRADOR';
    claims = { functionalEmail:email, functionalRole:'ADMIN', functionalGroup:group, functionalPermissions:FK_ALLOWED_SOURCES_ };
  } else if (email === FK_MANAGER_EMAIL_ && profile.role === 'gestor') {
    group = 'GESTOR';
    var permissions = profile.permissions || {};
    var allowed = [];
    if (permissions.managementIndicatorsRead === true || permissions.managementRead === true) allowed.push('performance');
    if (permissions.peopleManage === true || permissions.usersManage === true) {
      allowed.push('professionalRegistration', 'epidemiological', 'biosafetyManual');
    }
    claims = { functionalEmail:email, functionalRole:'GESTOR', functionalGroup:group, functionalPermissions:allowed };
  } else {
    var categoryId = sha256Hex_(JSON.stringify(email));
    var assignment = readFaDocument_(idToken, 'userCategories/' + categoryId);
    var allowedCategories = ['EFETIVO','RESIDENTE_1','RESIDENTE_2','RESIDENTE_3','SUBSTITUTO','ADMINISTRADOR','GESTOR'];
    var affiliations = assignment && Array.isArray(assignment.memberCategories)
      ? assignment.memberCategories.filter(function(value) { return ['EFETIVO','RESIDENTE_1','RESIDENTE_2','RESIDENTE_3','SUBSTITUTO'].indexOf(value) !== -1; }) : [];
    if (!assignment || assignment.schemaVersion !== 1 || assignment.identityStatus !== 'LINKED'
      || assignment.uid !== uid || normalizeEmail_(assignment.email) !== email
      || !Array.isArray(assignment.memberCategories) || new Set(assignment.memberCategories).size !== assignment.memberCategories.length
      || assignment.memberCategories.some(function(value) { return allowedCategories.indexOf(value) === -1; })
      || affiliations.length !== 1 || affiliations[0] !== 'EFETIVO')
      throw new Error('FK_AUTH_DENIED');
    group = 'EQUIPE';
    claims = { functionalEmail:email, functionalRole:'MEMBER', functionalGroup:group, functionalPermissions:[] };
  }
  return {code:'FK_AUTH_READY', uid:uid, email:email, group:group, permissions:claims.functionalPermissions,
    ...(issueToken ? {customToken:createFkCustomToken_(uid, claims)} : {})};
}

function submitFunctionalSurvey_(payload) {
  var allowed = payload && ['climate','stress','epidemiological'].indexOf(payload.survey) !== -1;
  if (!allowed || payload.cycle !== '2026' || typeof payload.faIdToken !== 'string') throw new Error('FK_SURVEY_INPUT_INVALID');
  var access = authorizeFaUser_(payload.faIdToken, false);
  if (access.group !== 'EQUIPE' && access.group !== 'ADMINISTRADOR') throw new Error('FK_SURVEY_ACCESS_DENIED');
  var response = validateFunctionalSurveyResponse_(payload.survey, payload.response);
  var uid = access.uid, survey = payload.survey, cycle = payload.cycle;
  var participationId = uid + '_' + survey + '_' + cycle;
  var documentRoot = 'projects/' + FK_PROJECT_ + '/databases/(default)/documents/';
  var writes = [];
  writes.push(createOnlyWrite_(documentRoot + 'surveyParticipation/' + participationId, {
    uid:uid, survey:survey, cycle:cycle, completed:true
  }));
  var responseFields = {survey_cycle:cycle, survey_version:response.survey_version, group:'team', answers:response.answers};
  if (response.stress_rating !== undefined) responseFields.stress_rating = response.stress_rating;
  writes.push(createOnlyWrite_(documentRoot + response.collection + '/' + response.submissionId, responseFields));
  if (survey === 'climate' && Object.keys(response.comments || {}).length || survey === 'epidemiological' && response.comments) {
    var commentId = Utilities.getUuid().replace(/-/g, '').toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(commentId) || commentId === response.submissionId) throw new Error('FK_SURVEY_RANDOM_ID_INVALID');
    writes.push(createOnlyWrite_(documentRoot + (survey === 'climate' ? 'climateComments/' : 'epidemiologicalComments/') + commentId,
      {survey_cycle:cycle, comments:response.comments}));
  }
  writes.push(createOnlyWrite_(documentRoot + 'functionalPerformanceAwards/' + participationId, {
    uid:uid, source:'FK', category:'SURVEYS', points:1, survey:survey, cycle:cycle, createdAt:Date.now()
  }));
  var result = UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/' + FK_PROJECT_
    + '/databases/(default)/documents:commit', {
      method:'post', contentType:'application/json',
      headers:{Authorization:'Bearer ' + getFkWriterAccessToken_()},
      payload:JSON.stringify({writes:writes}), muteHttpExceptions:true
    });
  if (result.getResponseCode() >= 200 && result.getResponseCode() < 300)
    return {code:'FK_SURVEY_SAVED', uid:uid, survey:survey, alreadyResponded:false};
  var body = result.getContentText();
  if (result.getResponseCode() === 409 || /ALREADY_EXISTS|FAILED_PRECONDITION/i.test(body))
    return {code:'FK_SURVEY_SAVED', uid:uid, survey:survey, alreadyResponded:true};
  throw new Error('FK_SURVEY_WRITE_FAILED');
}

function validateFunctionalSurveyResponse_(survey, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('FK_SURVEY_INPUT_INVALID');
  var answers = input.answers, comments = {}, allowedAnswers = {}, version, collection, submissionId;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new Error('FK_SURVEY_INPUT_INVALID');
  submissionId = input.submission_id;
  if (typeof submissionId !== 'string' || !/^[a-f0-9]{32}$/.test(submissionId)
      || input.survey_cycle !== '2026' || input.group && input.group !== 'team') throw new Error('FK_SURVEY_INPUT_INVALID');
  if (survey === 'climate') {
    var allowedFields = ['survey_version','survey_cycle','submission_id','consent','answers','comments','group'];
    if (Object.keys(input).some(function(key) { return allowedFields.indexOf(key) < 0; })
        || input.survey_version !== '1.4' || input.consent !== true) throw new Error('FK_SURVEY_INPUT_INVALID');
    for (var i = 1; i <= 32; i++) allowedAnswers['Q' + ('0' + i).slice(-2)] = true;
    for (var j = 1; j <= 5; j++) allowedAnswers['T' + ('0' + j).slice(-2)] = true;
    if (!Object.keys(answers).length || !Object.keys(answers).some(function(key) { return /^Q\d{2}$/.test(key); }))
      throw new Error('FK_SURVEY_INPUT_INVALID');
    Object.keys(answers).forEach(function(key) {
      var value = answers[key];
      if (!allowedAnswers[key] || !(value === 'NA' || Number.isInteger(value) && value >= 1 && value <= 5))
        throw new Error('FK_SURVEY_INPUT_INVALID');
    });
    if (input.comments !== undefined) {
      var allowedComments = {O01:true,O02:true,O03:true,O04:true,O05:true};
      if (!input.comments || typeof input.comments !== 'object' || Array.isArray(input.comments)) throw new Error('FK_SURVEY_INPUT_INVALID');
      Object.keys(input.comments).forEach(function(key) {
        var value = input.comments[key];
        if (!allowedComments[key] || typeof value !== 'string' || value.length > 1500) throw new Error('FK_SURVEY_INPUT_INVALID');
        if (value.trim()) comments[key] = value.trim();
      });
    }
    version = '1.4'; collection = 'climateResponses';
  } else if (survey === 'stress') {
    var stressFields = ['survey_version','survey_cycle','submission_id','group','answers','stress_rating'];
    if (Object.keys(input).some(function(key) { return stressFields.indexOf(key) < 0; }) || input.survey_version !== '1.2')
      throw new Error('FK_SURVEY_INPUT_INVALID');
    if (Object.keys(answers).length !== 30) throw new Error('FK_SURVEY_INPUT_INVALID');
    for (var k = 1; k <= 30; k++) {
      var question = 'S' + ('0' + k).slice(-2), score = answers[question];
      if (!Number.isInteger(score) || score < 0 || score > 5) throw new Error('FK_SURVEY_INPUT_INVALID');
      allowedAnswers[question] = true;
    }
    Object.keys(answers).forEach(function(key) { if (!allowedAnswers[key]) throw new Error('FK_SURVEY_INPUT_INVALID'); });
    if (input.stress_rating !== undefined && (!Number.isInteger(input.stress_rating) || input.stress_rating < 0 || input.stress_rating > 10))
      throw new Error('FK_SURVEY_INPUT_INVALID');
    version = '1.2'; collection = 'stressResponses';
  } else {
    var epiFields = ['ageBand','bmiBand','exercise','routineCare','diet','sleep','sleepHours','weeklyRest',
      'conditions','medication','familyHistory','tobacco','alcohol','exhaustion','pressure','pauses',
      'ergonomics','program','priorities'];
    var choices = {
      ageBand:['0','1','2','3','4','5','6','7'], bmiBand:['LOW','MID','UPPER','B30','B35','B40'],
      exercise:['0','1','2','3'], routineCare:['0','1','2','3','4','5'], diet:['0','1','2','3','4'],
      sleep:['0','1','2'], sleepHours:['0','1','2','3','4'], weeklyRest:['0','1','2','3'],
      conditions:['NONE','CARDIO','ENDO','RESP','MUSC','NEURO','RENAL','OTHER'], medication:['NO','YES'],
      familyHistory:['NONE','DIAB','HYPER','CARDIO','CANCER','RENAL','MENTAL','UNKNOWN'],
      tobacco:['0','1','2','3','4'], alcohol:['0','1','2','3'],
      exhaustion:['NEVER','RARELY','SOMETIMES','OFTEN','ALWAYS'], pressure:['NEVER','RARELY','SOMETIMES','OFTEN','ALWAYS'],
      pauses:['NEVER','RARELY','SOMETIMES','OFTEN','ALWAYS'], ergonomics:['NEVER','RARELY','SOMETIMES','OFTEN','ALWAYS'],
      program:['0','1','2'], priorities:['REST','FOOD','ACTIVITY','MENTAL','PREVENTION','ERGONOMICS','PAUSES']
    };
    var requiredEpi = ['survey_version','survey_cycle','submission_id','group','consent','answers','comments'];
    if (Object.keys(input).some(function(key) { return requiredEpi.indexOf(key) < 0; })
        || input.survey_version !== '1.0' || input.consent !== true || input.group !== 'team'
        || Object.keys(answers).some(function(key) { return epiFields.indexOf(key) < 0; })
        || typeof input.comments !== 'string' || input.comments.length > 1500)
      throw new Error('FK_SURVEY_INPUT_INVALID');
    var answered = false;
    epiFields.forEach(function(key) {
      var value = answers[key];
      if (key === 'conditions' || key === 'familyHistory' || key === 'priorities') {
        if (!Array.isArray(value) || value.some(function(item) { return choices[key].indexOf(item) < 0; })
            || new Set(value).size !== value.length || (key === 'conditions' && value.indexOf('NONE') !== -1 && value.length > 1)
            || (key === 'familyHistory' && value.indexOf('NONE') !== -1 && value.length > 1)
            || (key === 'familyHistory' && value.indexOf('UNKNOWN') !== -1 && value.length > 1))
          throw new Error('FK_SURVEY_INPUT_INVALID');
        if (value.length) answered = true;
      } else {
        if (typeof value !== 'string' || value !== 'NI' && choices[key].indexOf(value) < 0)
          throw new Error('FK_SURVEY_INPUT_INVALID');
        if (value !== 'NI') answered = true;
      }
    });
    if (Object.keys(answers).length !== epiFields.length || !answered) throw new Error('FK_SURVEY_INPUT_INVALID');
    version = '1.0'; collection = 'epidemiologicalResponses';
  }
  return {survey_version:version, collection:collection, submissionId:submissionId, answers:answers, comments:comments,
    ...(input.stress_rating !== undefined ? {stress_rating:input.stress_rating} : {}),
    ...(survey === 'epidemiological' ? {comments:String(input.comments || '').trim()} : {})};
}

function createOnlyWrite_(name, fields) {
  return {update:{name:name, fields:toFirestoreFields_(fields)}, currentDocument:{exists:false}};
}

function syncOwnOverview_(idToken) {
  var access = authorizeFaUser_(idToken, false), uid = access.uid;
  var canRead = access.group === 'EQUIPE' || access.group === 'ADMINISTRADOR';
  var permitted = access.permissions || [];
  var surveys = {state:'PREPARING'};
  var professional = {state:'PREPARING'};
  var sources = {};
  if (canRead || permitted.indexOf('performance') !== -1) sources.performance = {state:'PREPARING'};
  if (canRead || permitted.indexOf('professionalRegistration') !== -1) sources.professionalRegistration = professional;
  if (canRead || permitted.indexOf('fe') !== -1) sources.fe = surveys;
  if (canRead || permitted.indexOf('climateSurvey') !== -1) sources.climateSurvey = surveys.state === 'READY' ? {state:'READY',data:{participated:surveys.data.participation.climate > 0}} : surveys;
  if (canRead || permitted.indexOf('stressFatigue') !== -1) sources.stressFatigue = surveys.state === 'READY' ? {state:'READY',data:{participated:surveys.data.participation.stress > 0}} : surveys;
  if (canRead || permitted.indexOf('epidemiological') !== -1) sources.epidemiological = surveys.state === 'READY' ? {state:'READY',data:{participated:surveys.data.participation.epidemiological > 0}} : surveys;
  if (canRead || permitted.indexOf('biosafetyManual') !== -1) sources.biosafetyManual = {state:'PREPARING'};
  if (canRead || permitted.indexOf('vaccination') !== -1) sources.vaccination = {state:'PREPARING'};
  if (canRead || permitted.indexOf('dosimetry') !== -1) sources.dosimetry = {state:'PREPARING'};
  var snapshot = {schemaVersion:1, uid:uid, updatedAt:Date.now(), sources:sources};
  writeOwnSnapshot_(snapshot);
  return {code:'FK_SNAPSHOT_SAVED', uid:uid, snapshot:snapshot};
}

function writeOwnSnapshot_(snapshot) {
  validateSnapshot_(snapshot);
  var root='projects/'+FK_PROJECT_+'/databases/(default)/documents/';
  var response = UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/'+FK_PROJECT_+
    '/databases/(default)/documents:commit',{method:'post',contentType:'application/json',
      headers:{Authorization:'Bearer '+getFkWriterAccessToken_()},
      payload:JSON.stringify({writes:[{update:{name:root+'functionalProfiles/'+encodeURIComponent(snapshot.uid),
        fields:toFirestoreFields_(snapshot)}}]}),muteHttpExceptions:true});
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error('FK_FIRESTORE_WRITE_FAILED');
}

function readFaDocument_(idToken, path) {
  var url = 'https://firestore.googleapis.com/v1/projects/' + FA_PROJECT_
    + '/databases/(default)/documents/' + path.split('/').map(encodeURIComponent).join('/');
  var response = UrlFetchApp.fetch(url, {method:'get', headers:{Authorization:'Bearer ' + idToken}, muteHttpExceptions:true});
  if (response.getResponseCode() !== 200) return null;
  var document = JSON.parse(response.getContentText());
  return decodeFirestoreFields_(document.fields || {});
}

function createFkCustomToken_(uid, claims) {
  var now = Math.floor(Date.now() / 1000);
  var jwtPayload = {iss:FK_SIGNER_, sub:FK_SIGNER_, aud:FK_AUTH_AUDIENCE_, iat:now, exp:now + 3600, uid:uid, claims:claims};
  var customToken = signFkJwt_(jwtPayload);
  var exchanged = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=' + FK_API_KEY_, {
    method:'post', contentType:'application/json', payload:JSON.stringify({token:customToken, returnSecureToken:true}), muteHttpExceptions:true
  });
  if (exchanged.getResponseCode() !== 200) throw new Error('FK_AUTH_SIGNING_FAILED');
  var session = JSON.parse(exchanged.getContentText());
  if (session.localId !== uid || typeof session.idToken !== 'string') throw new Error('FK_AUTH_SIGNING_FAILED');
  return customToken;
}

function signFkJwt_(payload) {
  var signUrl = 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/'
    + encodeURIComponent(FK_SIGNER_) + ':signJwt';
  var signed = UrlFetchApp.fetch(signUrl, {method:'post', contentType:'application/json',
    headers:{Authorization:'Bearer ' + ScriptApp.getOAuthToken()},
    payload:JSON.stringify({payload:JSON.stringify(payload)}), muteHttpExceptions:true});
  if (signed.getResponseCode() !== 200) throw new Error('FK_AUTH_SIGNING_FAILED');
  var signedJwt = JSON.parse(signed.getContentText()).signedJwt;
  if (typeof signedJwt !== 'string' || signedJwt.length < 100 || signedJwt.length > 12000)
    throw new Error('FK_AUTH_SIGNING_FAILED');
  return signedJwt;
}

/** Firestore writes run as the narrowly-scoped FK service account, not the script owner. */
function getFkWriterAccessToken_() {
  var now = Math.floor(Date.now() / 1000);
  var assertion = signFkJwt_({iss:FK_SIGNER_, scope:'https://www.googleapis.com/auth/datastore',
    aud:'https://oauth2.googleapis.com/token', iat:now, exp:now + 3600});
  var response = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method:'post', contentType:'application/x-www-form-urlencoded',
    payload:{grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion:assertion},
    muteHttpExceptions:true
  });
  if (response.getResponseCode() !== 200) throw new Error('FK_FIRESTORE_WRITER_AUTH_FAILED');
  var token = JSON.parse(response.getContentText());
  if (typeof token.access_token !== 'string' || !Number.isInteger(Number(token.expires_in)) || Number(token.expires_in) < 60)
    throw new Error('FK_FIRESTORE_WRITER_AUTH_FAILED');
  return token.access_token;
}

function decodeFirestoreFields_(fields) {
  var result = {};
  Object.keys(fields).forEach(function(key) { result[key] = decodeFirestoreValue_(fields[key]); });
  return result;
}
function decodeFirestoreValue_(value) {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.nullValue !== undefined) return null;
  if (value.arrayValue) return (value.arrayValue.values || []).map(decodeFirestoreValue_);
  if (value.mapValue) return decodeFirestoreFields_(value.mapValue.fields || {});
  return null;
}
function normalizeEmail_(value) { return String(value || '').trim().toLowerCase(); }
function sha256Hex_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function verifyEnvelope_(envelope) {
  if (!envelope || typeof envelope !== 'object' || typeof envelope.timestamp !== 'string' ||
      !/^\d{13}$/.test(envelope.timestamp) || Math.abs(Date.now() - Number(envelope.timestamp)) > 5 * 60 * 1000 ||
      typeof envelope.nonce !== 'string' || !/^[0-9a-f-]{36}$/i.test(envelope.nonce) ||
      typeof envelope.payload !== 'string' || envelope.payload.length > 500000 ||
      typeof envelope.signature !== 'string' || !/^[0-9a-f]{64}$/.test(envelope.signature)) throw new Error('FK_ENVELOPE_INVALID');
  var key = 'fk_nonce_' + envelope.nonce;
  var payload;
  try { payload = JSON.parse(envelope.payload); } catch (_) { throw new Error('FK_ENVELOPE_INVALID'); }
  var properties=PropertiesService.getScriptProperties(),secret;
  secret=properties.getProperty('FK_HMAC_SECRET');
  if (!secret || secret.length < 32) throw new Error('FK_SECRET_NOT_CONFIGURED');
  var message = envelope.timestamp + '\n' + envelope.nonce + '\n' + envelope.payload;
  var bytes = Utilities.computeHmacSha256Signature(message, secret, Utilities.Charset.UTF_8);
  var expected = bytes.map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
  if (!constantTimeEqual_(expected, envelope.signature)) throw new Error('FK_SIGNATURE_INVALID');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('FK_REPLAY_GUARD_BUSY');
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get(key)) throw new Error('FK_REPLAY_DENIED');
    cache.put(key, '1', 600);
  } finally { lock.releaseLock(); }
  return payload;
}
function validateSnapshot_(s) {
  if (!s || s.schemaVersion !== 1 || typeof s.uid !== 'string' || !/^[A-Za-z0-9_.@+:%-]{1,128}$/.test(s.uid) ||
      !s.sources || typeof s.sources !== 'object' ||
      !Number.isSafeInteger(s.updatedAt) || Object.keys(s.sources).some(function(k) { return !FK_ALLOWED_SOURCES_.includes(k); }))
    throw new Error('FK_SNAPSHOT_INVALID');
}
function toFirestoreFields_(value) {
  var fields = {};
  Object.keys(value).forEach(function(key) { fields[key] = toFirestoreValue_(value[key]); });
  return fields;
}
function toFirestoreValue_(value) {
  if (value === null) return {nullValue:null};
  if (typeof value === 'boolean') return {booleanValue:value};
  if (typeof value === 'number') return Number.isInteger(value) ? {integerValue:String(value)} : {doubleValue:value};
  if (typeof value === 'string') return {stringValue:value};
  if (Array.isArray(value)) return {arrayValue:{values:value.map(toFirestoreValue_)}};
  if (value && typeof value === 'object') return {mapValue:{fields:toFirestoreFields_(value)}};
  throw new Error('FK_SNAPSHOT_INVALID');
}
function constantTimeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var mismatch = 0;
  for (var i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
