// Public Firebase Web configuration verified by API; no administrative credentials.
export const GOOGLE_PROJECT_CONFIG = Object.freeze({
  "FA": {
    "label": "SAHMT",
    "googleButtonOriginVerified": true,
    "sessionPersistenceVerified": true,
    "globalSignOutVerified": true,
    "appName": "sahmt-v2",
    "config": {
      "apiKey": "AIzaSyDg7plEPhaIieyDP3z462gxG9cY_OQCzvA",
      "authDomain": "sahmt-17a16.firebaseapp.com",
      "projectId": "sahmt-17a16",
      "storageBucket": "sahmt-17a16.firebasestorage.app",
      "messagingSenderId": "1072832154794",
      "appId": "1:1072832154794:web:38e8e627d4189ebb0a14d3"
    },
    "googleEnabled": true,
    "acceptedGoogleClientIds": [
      "1072832154794-lb4cu9dcg3q49t60dadp9cc5m6h7dhai.apps.googleusercontent.com"
    ],
    "credentialExchangeVerified": true
  },
  "FB": {
    "label": "Gestão e Desempenho",
    "appName": "sahmt-fb-independent",
    "config": {
      "apiKey": "AIzaSyBYzRB28_ashHrVe7AXsUDvLWc4N2Cj-y8",
      "authDomain": "sahmt-gestao-5ae66.firebaseapp.com",
      "projectId": "sahmt-gestao-5ae66",
      "storageBucket": "sahmt-gestao-5ae66.firebasestorage.app",
      "messagingSenderId": "613953519880",
      "appId": "1:613953519880:web:63b48dfa78ffd1f7ef6cbd"
    },
    "googleEnabled": true,
    "acceptedGoogleClientIds": [
      "1072832154794-lb4cu9dcg3q49t60dadp9cc5m6h7dhai.apps.googleusercontent.com"
    ],
    "credentialExchangeVerified": true,
    "clientSignupDisabled": true
  },
  "FC": {
    "label": "Registros",
    "appName": "sahmt-fc-direct",
    "config": {
      "apiKey": "AIzaSyA_NMnXXdGgd6aM0AHHWut0uifw5hXKYrw",
      "authDomain": "indicadores---sahmt.firebaseapp.com",
      "projectId": "indicadores---sahmt",
      "storageBucket": "indicadores---sahmt.firebasestorage.app",
      "messagingSenderId": "37778688850",
      "appId": "1:37778688850:web:314e7dd16e6fd8b332088b"
    },
    "googleEnabled": true,
    "acceptedGoogleClientIds": [
      "1072832154794-lb4cu9dcg3q49t60dadp9cc5m6h7dhai.apps.googleusercontent.com"
    ],
    "credentialExchangeVerified": true,
    "clientSignupDisabled": true
  },
  "FD": {
    "label": "Indicadores",
    "appName": "sahmt-fd-direct",
    "config": {
      "apiKey": "AIzaSyASifVm_jtSW8Q7wABBp5fgzMqaGuZTyb8",
      "authDomain": "rotinas-8a617.firebaseapp.com",
      "projectId": "rotinas-8a617",
      "storageBucket": "rotinas-8a617.firebasestorage.app",
      "messagingSenderId": "733135756355",
      "appId": "1:733135756355:web:66a9d5c66e7889586748f6"
    },
    "googleEnabled": true,
    "acceptedGoogleClientIds": [
      "1072832154794-lb4cu9dcg3q49t60dadp9cc5m6h7dhai.apps.googleusercontent.com"
    ],
    "credentialExchangeVerified": true,
    "clientSignupDisabled": true
  },
  "FE": {
    "label": "Enquetes/Consultas",
    "appName": "sahmt-fe-direct",
    "config": {
      "apiKey": "AIzaSyCWgKi55gx_jJ0h5gwqBaj5hQlc4SDwtrE",
      "authDomain": "outros-48120.firebaseapp.com",
      "projectId": "outros-48120",
      "storageBucket": "outros-48120.firebasestorage.app",
      "messagingSenderId": "212923638152",
      "appId": "1:212923638152:web:08c026c286ede7100eda3d"
    },
    "googleEnabled": true,
    "acceptedGoogleClientIds": [
      "1072832154794-lb4cu9dcg3q49t60dadp9cc5m6h7dhai.apps.googleusercontent.com"
    ],
    "credentialExchangeVerified": true,
    "clientSignupDisabled": true
  }
});

// Enable only after direct credential/UID proofs and release review.
export const googleProjectAuthEnabled = import.meta.env?.VITE_GOOGLE_PROJECT_AUTH_ENABLED === 'true';
