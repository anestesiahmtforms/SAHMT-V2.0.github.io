function safeFileName(value) {
  return String(value || 'SAHMT-Relatorio')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'SAHMT-Relatorio';
}

export function createAndSharePdf({title, period, fileName, columns, rows, orientation = columns.length > 6 ? 'landscape' : 'portrait', alertRowIndexes = [], labelDateGroups = []}) {
  const pdf = new jsPDF({orientation, unit: 'mm', format: 'a4'});
  const isMonthlyLabels = Array.isArray(labelDateGroups) && labelDateGroups.length === rows.length && rows.length > 0;
  const margin = 12;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const headerColor = isMonthlyLabels ? [11, 63, 58] : [13, 50, 87];
  pdf.setFillColor(...headerColor);
  pdf.rect(0, 0, pageWidth, isMonthlyLabels ? 24 : 31, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.text(isMonthlyLabels ? 'ETIQUETAS SAHMT' : 'SAHMT · GESTÃO RESPONSÁVEL', margin, isMonthlyLabels ? 11 : 10);
  pdf.setFontSize(15);
  if (!isMonthlyLabels) pdf.text(title, margin, 19, {maxWidth: pageWidth - margin * 2});
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.text(period, margin, isMonthlyLabels ? 18 : 26);

  autoTable(pdf, {
    head: [columns],
    body: rows,
    startY: isMonthlyLabels ? 30 : 36,
    margin: {left: margin, right: margin, bottom: 14},
    styles: {font: 'helvetica', fontSize: isMonthlyLabels ? 7.5 : columns.length > 7 ? 7 : 8, cellPadding: 2, overflow: 'linebreak', valign: 'top'},
    headStyles: {fillColor: isMonthlyLabels ? [11, 63, 58] : [23, 98, 161], textColor: 255, fontStyle: 'bold', halign: isMonthlyLabels ? 'center' : 'left'},
    alternateRowStyles: {fillColor: [241, 247, 249]},
    ...(isMonthlyLabels ? {columnStyles: {0: {cellWidth: 8, halign: 'center'}, 1: {cellWidth: 20}, 2: {cellWidth: 45}}} : {}),
    didParseCell: (cell) => {
      if (isMonthlyLabels && cell.section === 'body') {
        const group = labelDateGroups[cell.row.index] || {groupIndex: 0, rowInGroup: 0};
        const dateFills = [[189, 224, 235], [208, 231, 216], [244, 218, 181], [218, 216, 241]];
        const rowFills = [[248, 252, 250], [242, 247, 252]];
        const dateColumnIndex = columns.indexOf('Data');
        cell.cell.styles.textColor = cell.column.index === dateColumnIndex ? [36, 78, 112] : (group.rowInGroup % 2 === 0 ? [36, 78, 112] : [93, 104, 128]);
        cell.cell.styles.fillColor = cell.column.index === dateColumnIndex ? dateFills[group.groupIndex % dateFills.length] : rowFills[group.rowInGroup % rowFills.length];
        if (cell.column.index === dateColumnIndex) cell.cell.styles.fontStyle = 'bold';
      }
      if (cell.section === 'body' && alertRowIndexes.includes(cell.row.index)) {
        cell.cell.styles.textColor = isMonthlyLabels ? [133, 77, 14] : [185, 28, 28];
        cell.cell.styles.fontStyle = 'bold';
        cell.cell.styles.fillColor = isMonthlyLabels ? [255, 248, 235] : [255, 241, 242];
      }
    },
    didDrawPage: () => {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(82, 101, 120);
      pdf.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, margin, pageHeight - 7);
      pdf.text(`Página ${pdf.internal.getCurrentPageInfo().pageNumber}`, pageWidth - margin, pageHeight - 7, {align: 'right'});
    }
  });

  const name = `${safeFileName(fileName)}.pdf`;
  if (typeof File === 'function' && typeof navigator.share === 'function') {
    const file = new File([pdf.output('blob')], name, {type: 'application/pdf'});
    if (typeof navigator.canShare === 'function' && navigator.canShare({files: [file]})) {
      return navigator.share({files: [file], title, text: `${title} · ${period}`}).then(() => 'shared');
    }
  }
  pdf.save(name);
  return Promise.resolve('downloaded');
}
import {jsPDF} from 'jspdf';
import {autoTable} from 'jspdf-autotable';
