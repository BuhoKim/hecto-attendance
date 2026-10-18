const getColumnName = (index) => {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
};

const border = { style: 'thin', color: { rgb: 'D9E2F3' } };

export const getAttendanceWorkbookRows = (rows = []) => rows.map(({ 비고, ...row }) => row);

export const ATTENDANCE_WORKBOOK_COLUMN_WIDTHS = [13, 14, 18, 10, 10, 24, 18];

export const applyAttendanceSheetStyles = (sheet, { rowCount = 1, columnCount = 1 } = {}) => {
  const lastColumn = getColumnName(Math.max(0, columnCount - 1));
  sheet['!autofilter'] = { ref: `A1:${lastColumn}${rowCount}` };
  sheet['!freeze'] = { xSplit: 0, ySplit: 1 };
  sheet['!rows'] = [{ hpt: 24 }, ...Array.from({ length: Math.max(0, rowCount - 1) }, () => ({ hpt: 21 }))];

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const isHeader = rowIndex === 0;
    const statusCell = sheet[`${getColumnName(5)}${rowIndex + 1}`];
    const isLate = !isHeader && statusCell?.v === '지각';
    const fillColor = isHeader ? '1F4E78' : isLate ? 'FFF8D6' : rowIndex % 2 === 0 ? 'F8FAFC' : 'FFFFFF';
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const cell = sheet[`${getColumnName(columnIndex)}${rowIndex + 1}`];
      if (!cell) continue;
      cell.s = {
        fill: { patternType: 'solid', fgColor: { rgb: fillColor } },
        font: { name: '맑은 고딕', sz: isHeader ? 11 : 10, bold: isHeader || (isLate && columnIndex === 6), color: { rgb: isHeader ? 'FFFFFF' : '1F2937' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border: { top: border, bottom: border, left: border, right: border },
      };
      if (isLate && columnIndex === 5) {
        cell.s.fill = { patternType: 'solid', fgColor: { rgb: 'FFE69A' } };
        cell.s.font.color = { rgb: '8A5A00' };
      }
    }
  }
  return sheet;
};
