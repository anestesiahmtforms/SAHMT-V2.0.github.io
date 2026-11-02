import './vacations-2027.css';

// Visual structure only. Keep the source reference without contacting Drive or
// importing the original app's API, member sessions, reservations or rules.
export const VACATIONS_2027_REFERENCE = Object.freeze({
  source: 'https://anestesiahmtforms.github.io/ferias2027/',
  driveFolder: 'https://drive.google.com/drive/folders/1MmQUTSE0oWVpgrhV8IBzTW7h0E8O3okl',
});

// Row counts follow the original spreadsheet layout; periods and initials
// deliberately remain blank until the next implementation stage.
const months = [
  ['JANEIRO', 4], ['FEVEREIRO', 4], ['MARÇO', 5], ['ABRIL', 4],
  ['MAIO', 4], ['JUNHO', 5], ['JULHO', 4], ['AGOSTO', 4],
  ['SETEMBRO', 5], ['OUTUBRO', 4], ['NOVEMBRO', 4], ['DEZEMBRO', 5],
];

export function vacations2027Markup({isAdmin = false} = {}) {
  return `<section class="vacations-2027" aria-label="Estrutura da escala de férias 2027">
    <header class="vacations-2027__intro">
      <p class="vacations-2027__eyebrow">SAHMT · FE</p>
      <h3>Escala de férias 2027</h3>
      <p>Estrutura visual. Períodos e reservas serão configurados posteriormente.</p>
    </header>
    <p class="vacations-2027__status">Somente estrutura — marcações e atualizações ainda não estão disponíveis.</p>
    <div class="vacations-2027__toolbar"><button type="button" disabled>Atualizar escala</button></div>
    <div class="vacations-2027__grid">${months.map(([month, rows]) => `
      <article class="vacations-2027__month">
        <table aria-label="Escala de ${month.toLocaleLowerCase('pt-BR')} de 2027">
          <colgroup><col class="vacations-2027__week"><col class="vacations-2027__period"><col><col><col></colgroup>
          <thead>
            <tr><th class="vacations-2027__month-title" colspan="5"><h4>${month}</h4></th></tr>
            <tr><th scope="col">SEMANA</th><th scope="col">PERÍODO</th><th scope="col">SIGLA 1</th><th scope="col">SIGLA 2</th><th scope="col">SIGLA 3</th></tr>
          </thead>
          <tbody>${Array.from({length: rows}, (_, index) => `<tr><th scope="row">${index + 1}ª SEMANA</th><td aria-label="Período a definir">—</td><td aria-label="Sigla 1 não configurada"></td><td aria-label="Sigla 2 não configurada"></td><td aria-label="Sigla 3 não configurada"></td></tr>`).join('')}</tbody>
        </table>
      </article>`).join('')}
    </div>
    ${isAdmin ? '<footer class="vacations-2027__admin"><button type="button" disabled>Gestão administrativa</button></footer>' : ''}
  </section>`;
}
