// Chart colors, per the Data Visualization section of DESIGN.md.
//
// Two rules are load-bearing here. First, the health ramp (mahogany /
// terracotta / danger) is reserved for actual component health — a wear chart
// or a conditions breakdown borrowing it would dilute the one signal the
// product exists to deliver. Second, marks follow the Two Inks Rule: fills go
// behind things (areas, bars), inks go on things (lines, labels).
export const CHART = {
  axis: '#8A8A91', // stone-light: the dimmest usable text tone
  grid: 'rgba(58, 58, 62, 0.5)', // ash, translucent
  wearLine: '#9CB0A4', // mint ink
  wearFill: 'rgba(120, 140, 128, 0.25)', // sage fill
  serviceMark: '#788C80', // sage ink
};
