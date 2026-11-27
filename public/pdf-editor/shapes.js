const polygon = points => points.map((point, index) => [index ? 'L' : 'M', ...point]).concat([['Z']]);
const star = (points = 5) => Array.from({ length: points * 2 }, (_, index) => {
  const angle = index * Math.PI / points - Math.PI / 2;
  const radius = index % 2 ? 19 : 45;
  return [50 + radius * Math.cos(angle), 50 + radius * Math.sin(angle)];
});

export const shapes = [
  { id: 'rectangle', name: 'Прямоугольник', path: polygon([[5,10],[95,10],[95,90],[5,90]]) },
  { id: 'rounded', name: 'Скруглённый прямоугольник', path: [['M',20,10],['L',80,10],['C',92,10,95,16,95,29],['L',95,71],['C',95,84,92,90,80,90],['L',20,90],['C',8,90,5,84,5,71],['L',5,29],['C',5,16,8,10,20,10],['Z']] },
  { id: 'ellipse', name: 'Овал', path: [['M',50,5],['C',75,5,95,25,95,50],['C',95,75,75,95,50,95],['C',25,95,5,75,5,50],['C',5,25,25,5,50,5],['Z']] },
  { id: 'triangle', name: 'Треугольник', path: polygon([[50,5],[95,90],[5,90]]) },
  { id: 'diamond', name: 'Ромб', path: polygon([[50,5],[95,50],[50,95],[5,50]]) },
  { id: 'hexagon', name: 'Шестиугольник', path: polygon([[25,10],[75,10],[95,50],[75,90],[25,90],[5,50]]) },
  { id: 'arrow', name: 'Стрелка', path: polygon([[5,31],[59,31],[59,9],[95,50],[59,91],[59,69],[5,69]]) },
  { id: 'double-arrow', name: 'Двойная стрелка', path: polygon([[5,50],[31,14],[31,32],[69,32],[69,14],[95,50],[69,86],[69,68],[31,68],[31,86]]) },
  { id: 'line', name: 'Линия', path: [['M',7,85],['L',93,15]], stroke: true },
  { id: 'star', name: 'Звезда', path: polygon(star()) },
  { id: 'cross', name: 'Крест', path: polygon([[34,6],[66,6],[66,34],[94,34],[94,66],[66,66],[66,94],[34,94],[34,66],[6,66],[6,34],[34,34]]) },
  { id: 'callout', name: 'Выноска', path: polygon([[5,10],[95,10],[95,72],[48,72],[23,94],[27,72],[5,72]]) },
];

export function shapeIcon(shape) {
  const path = shape.path.map(command => command.join(' ')).join(' ');
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="${path}" fill="${shape.stroke ? 'none' : 'currentColor'}" stroke="currentColor" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
