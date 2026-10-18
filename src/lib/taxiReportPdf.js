const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const formatAmount = (value) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? `${Math.round(amount).toLocaleString('ko-KR')}원` : '0원';
};

export const formatTaxiPdfDateTime = (value) => String(value ?? '').trim().replace('T', ' ').replace(/\s+/, '\n');
export const TAXI_PDF_COLUMN_WIDTHS = [6, 9, 10, 21, 10, 21, 15, 8];

export const buildTaxiPdfRows = (rows = []) => rows.map((row, index) => ({
  no: index + 1,
  employeeName: row.employeeName || '',
  boardingAt: formatTaxiPdfDateTime(row.rideTime),
  pickup: row.pickup || '',
  arrivalAt: formatTaxiPdfDateTime(row.arrivalTime),
  dropoff: row.dropoff || '',
  reason: row.reason || '',
  amount: Number(row.amount || 0),
})).sort((a, b) => a.boardingAt.localeCompare(b.boardingAt, 'ko') || a.employeeName.localeCompare(b.employeeName, 'ko'))
  .map((row, index) => ({ ...row, no: index + 1 }));

export const getTaxiPdfTotalAmount = (rows = []) => rows.reduce((total, row) => total + (Number(row.amount) || 0), 0);

export const getTaxiPdfPageDimensions = (canvasWidth, canvasHeight) => ({
  width: 210,
  height: Number((Number(canvasHeight) / Number(canvasWidth) * 210).toFixed(2)),
});

export const TAXI_PDF_PAGE_ROW_COUNT = 30;

const renderTablePage = (rows, pageNumber, pageCount, totalAmount, isLastPage) => {
  const page = document.createElement('div');
  page.style.cssText = 'width:1120px;background:#fff;color:#111;padding:34px 36px 28px;box-sizing:border-box;font-family:Arial,"Malgun Gothic",sans-serif;';
  const title = pageCount > 1
    ? `<div style="font-size:12px;text-align:right;margin-bottom:8px;color:#555;">${pageNumber} / ${pageCount}</div>`
    : '';
  page.innerHTML = `${title}
    <table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:11px;text-align:center;">
      <colgroup>${TAXI_PDF_COLUMN_WIDTHS.map((width) => `<col style="width:${width}%">`).join('')}</colgroup>
      <thead><tr>${['NO', '직원명', '탑승일시', '탑승위치', '도착일시', '도착위치', '이용사유', '결제금액'].map((label) => `<th style="border:1px solid #111;padding:6px 4px;background:#fff;font-weight:700;text-align:center;">${label}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((row) => {
        const cell = (value, extra = '') => `<td style="border:1px solid #111;padding:3px 4px;min-height:38px;vertical-align:middle;line-height:1.18;word-break:keep-all;overflow-wrap:anywhere;white-space:normal;${extra}"><div style="white-space:normal;overflow-wrap:anywhere;">${escapeHtml(value).replaceAll('\n', '<br>')}</div></td>`;
        return `<tr>${cell(row.no)}${cell(row.employeeName)}${cell(row.boardingAt)}${cell(row.pickup)}${cell(row.arrivalAt)}${cell(row.dropoff)}${cell(row.reason)}${cell(formatAmount(row.amount), 'white-space:nowrap;')}</tr>`;
      }).join('')}${isLastPage ? `<tr><td colspan="7" style="border:1px solid #111;padding:6px 4px;text-align:center;font-weight:700;height:28px;">총합 금액</td><td style="border:1px solid #111;padding:6px 4px;text-align:center;font-weight:700;white-space:nowrap;">${formatAmount(totalAmount)}</td></tr>` : ''}</tbody>
    </table>`;
  return page;
};

export async function downloadTaxiReportPdf(rows = [], { startDate = '', endDate = '', dept = '전체부서' } = {}) {
  if (typeof document === 'undefined') throw new Error('PDF 다운로드는 브라우저에서만 사용할 수 있습니다.');
  const [{ jsPDF }, html2canvasModule] = await Promise.all([
    import('jspdf'),
    import('html2canvas'),
  ]);
  const html2canvas = html2canvasModule.default || html2canvasModule;
  const pdfRows = buildTaxiPdfRows(rows);
  if (pdfRows.length === 0) throw new Error('다운로드할 이용내역이 없습니다.');

  const pageSize = TAXI_PDF_PAGE_ROW_COUNT;
  const pages = [];
  for (let index = 0; index < pdfRows.length; index += pageSize) pages.push(pdfRows.slice(index, index + pageSize));
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const totalAmount = getTaxiPdfTotalAmount(pdfRows);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;z-index:-1;background:#fff;';
  document.body.appendChild(host);
  try {
    for (let index = 0; index < pages.length; index += 1) {
      const page = renderTablePage(pages[index], index + 1, pages.length, totalAmount, index === pages.length - 1);
      host.appendChild(page);
      const canvas = await html2canvas(page, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      const image = canvas.toDataURL('image/jpeg', 0.96);
      const dimensions = getTaxiPdfPageDimensions(canvas.width, canvas.height);
      if (index > 0) pdf.addPage();
      pdf.addImage(image, 'JPEG', 0, 0, dimensions.width, dimensions.height, undefined, 'FAST');
      page.remove();
    }
  } finally {
    host.remove();
  }
  const safeDept = String(dept || '전체부서').replace(/[\\/:*?"<>|]/g, '_');
  pdf.save(`카카오T이용내역_${startDate}_${endDate}_${safeDept}.pdf`);
}
