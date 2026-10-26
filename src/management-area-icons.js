const paths = {
  documents: '<path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3M9 3h6l6 6v5H9zM15 3v6h6M12 12h6M6 16h7M6 18h5"/>',
  administration: '<rect x="4" y="7" width="16" height="14" rx="2"/><path d="M9 7V4h6v3M8 12h2m4 0h2M8 16h2m4 0h2M10 21v-2h4v2"/>',
  operations: '<path d="M9 4H6a2 2 0 0 0-2 2v14h16V6a2 2 0 0 0-2-2h-3"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="m7 11 1.5 1.5L11 10m2 2h4m-10 5h3m3 0h4"/>',
  clinical: '<path d="M5 3v5a4 4 0 0 0 8 0V3M3 3h4m4 0h4M9 12v3a5 5 0 0 0 10 0v-1"/><circle cx="19" cy="11" r="3"/>',
  quality: '<path d="m12 2 8 3v6c0 5-8 10-8 10S4 16 4 11V5zM8 11l3 3 5-6"/>',
  care: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/><path d="M10 11h4m-2-2v6"/>',
  ethics: '<path d="M12 3v17M6 21h12M4 7h16M6 7l-3 7h6L6 7Zm12 0-3 7h6l-3-7Z"/><circle cx="12" cy="5" r="2"/>',
  equipment: '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M7 10h2l2-4 3 7 2-3h2M9 20h6m-3-4v4"/>',
  people: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 5a5 5 0 0 1 3 4v2"/>',
  records: '<path d="M8 3H5v18h14V3h-3"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 11h6m-3-3v6M8 18h8"/>',
  consultation: '<path d="M12 21s-9-5.5-9-12a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6.5-9 12-9 12Z"/><path d="M6 12h3l2-4 3 8 2-4h2"/>',
  finance: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M16 10h5v5h-5a2.5 2.5 0 0 1 0-5ZM7 9h4m-4 4h2"/><circle cx="17" cy="12.5" r=".5"/>',
  admin: '<path d="m12 2 8 3v6c0 5-8 10-8 10S4 16 4 11V5z"/><circle cx="12" cy="10" r="2"/><path d="M12 12v4m0-1h2"/>',
  notifications: '<path d="M6 8a6 6 0 0 1 12 0v6l2 3H4l2-3V8ZM10 21h4M12 2V1"/>',
  management: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M14 18h7m-3.5-3.5v7"/>'
};
const areas = {
  'area-gestao-de-documentos': ['documents','blue'],
  'area-coordenacao-administrativa': ['administration','gold'],
  'area-gestao-operacional': ['operations','teal'],
  'area-coordenacao-clinica': ['clinical','blue'],
  'area-gestao-da-qualidade': ['quality','teal'],
  'area-gestao-das-areas-assistenciais-extra-bloco': ['care','coral'],
  'area-gestao-de-conduta-etica': ['ethics','plum'],
  'area-gestao-de-equipamentos': ['equipment','blue'],
  'area-gestao-de-pessoas': ['people','plum'],
  'area-gestao-de-prontuario': ['records','teal'],
  'area-gestao-do-ambulatorio-pre-anestesico': ['consultation','coral'],
  'area-gestao-financeira': ['finance','gold'],
  'utility-people': ['people','plum'],
  'utility-admin': ['admin','blue'],
  'utility-notifications': ['notifications','gold']
};

// Fixed SVG markup only: Firestore labels/IDs never become SVG or CSS content.
export function managementAreaIcon(item = {}) {
  const slug = 'area-' + String(item.name || item.title || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const [kind,tone] = areas[item.id] || areas[slug] || ['management','blue'];
  return `<span class="management-area-icon management-area-icon--${tone}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" focusable="false">${paths[kind]}</svg></span>`;
}
