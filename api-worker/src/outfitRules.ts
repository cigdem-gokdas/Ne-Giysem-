export type ClothingSummary = {
  id: string;
  tur: string;
  renk: string;
  kesim: string;
  alt_tur: string;
  kemer_uygun: boolean;
  son_kullanim: number | 'hic';
  kullanim_sayisi: number;
};

type Recommendation = { mesaj: string; secilen_idler: string[] };

function normalized(value: string): string { return value.trim().toLocaleLowerCase('tr-TR'); }

function leastUsed(items: ClothingSummary[]): ClothingSummary | undefined {
  return [...items].sort((left, right) => left.kullanim_sayisi - right.kullanim_sayisi)[0];
}

export function completeOutfit(
  recommendation: Recommendation,
  wardrobe: ClothingSummary[],
  replacement = false,
): Recommendation {
  const byId = new Map(wardrobe.map((item) => [item.id, item]));
  let selected = [...recommendation.secilen_idler];
  const external: string[] = [];
  const contains = (predicate: (item: ClothingSummary) => boolean) => selected.some((id) => {
    const item = byId.get(id);
    return item ? predicate(item) : false;
  });
  const addAvailable = (predicate: (item: ClothingSummary) => boolean, suggestion: string) => {
    if (contains(predicate)) return;
    if (!replacement) {
      const candidate = leastUsed(wardrobe.filter((item) => predicate(item) && !selected.includes(item.id)));
      if (candidate) { selected.push(candidate.id); return; }
    }
    external.push(suggestion);
  };

  if (!replacement) {
    const bottomIsWide = contains((item) => normalized(item.tur) === 'alt' && normalized(item.kesim) === 'bol');
    if (bottomIsWide) {
      selected = selected.filter((id) => normalized(byId.get(id)?.tur ?? '') !== 'üst' || normalized(byId.get(id)?.kesim ?? '') === 'dar');
    }
    if (bottomIsWide && !contains((item) => normalized(item.tur) === 'üst' && normalized(item.kesim) === 'dar')) {
      const fittedTop = leastUsed(wardrobe.filter((item) => normalized(item.tur) === 'üst' && normalized(item.kesim) === 'dar'));
      if (fittedTop) selected.push(fittedTop.id);
      else external.push('Bol alt parçayı dengelemek için vücuda oturan siyah bir üst');
    }
  }

  if (!contains((item) => normalized(item.tur) === 'üst') && !external.some((note) => note.includes('bir üst'))) {
    addAvailable((item) => normalized(item.tur) === 'üst', 'Vücuda oturan siyah triko bir üst');
  }
  if (!contains((item) => normalized(item.tur) === 'alt')) {
    addAvailable((item) => normalized(item.tur) === 'alt' && (contains((top) => normalized(top.tur) === 'üst' && normalized(top.kesim) === 'dar') || normalized(item.kesim) !== 'bol'), 'Lacivert, dengeli kesimli bir pantolon');
  }

  addAvailable((item) => normalized(item.tur) === 'dış giyim', 'Lacivert, yapılı kesimli vintage bir ceket');
  addAvailable((item) => normalized(item.tur) === 'ayakkabı', 'Siyah blok topuklu Mary Jane ayakkabı');
  addAvailable((item) => normalized(item.alt_tur) === 'çanta', 'Bordo deri vintage bir çanta');
  if (contains((item) => normalized(item.tur) === 'alt' && item.kemer_uygun)) {
    addAvailable((item) => normalized(item.alt_tur) === 'kemer', 'Kombinin renklerine uyan koyu deri bir kemer');
  }

  const note = external.length ? ` Gardırobunda olmayan tamamlayıcılar: ${external.join('; ')}.` : '';
  return { mesaj: `${recommendation.mesaj.trim()}${note}`.slice(0, 800), secilen_idler: selected };
}
