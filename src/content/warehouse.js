/** Unity Warehouse.prefab の説明文・収納品（広安小学校） */
export const WAREHOUSE = {
  id: 'warehouse',
  title: '防災倉庫',
  place: '広安小学校',
  targetSrc: './targets/warehouse.mind',

  /** 音声ナレーション用セリフ（ユーザー側で音声を作成） */
  narration: [
    '防災倉庫って何？',
    '防災倉庫は、災害が起きたときに、みんなの命を守るための食料や道具、約3日分をためてある倉庫だよ！',
    '何のためにどう使うの？',
    '防災倉庫は、災害直後の救助活動や避難生活のために使われるよ！鍵を持っている人が開けて中の物を運び出すんだ！',
  ].join('\n'),

  intro: [
    {
      title: '防災倉庫って何？',
      body: '防災倉庫は、災害が起きたときに、みんなの命を守るための食料や道具（約3日分）をためてある倉庫だよ！',
    },
    {
      title: '何のためにどう使うの？',
      body: '防災倉庫は、災害直後の救助活動や避難生活のために使われるよ！鍵を持っている人が開けて中の物を運び出すんだ！',
    },
  ],

  categories: [
    {
      id: 'rescue',
      label: '救助用資機材',
      items: [
        { code: '救助01-2', name: 'LED投光器', qty: '1基' },
        { code: '救助02', name: '発電機', qty: '1台' },
        { code: '救助03', name: 'チェーンソー', qty: '1台' },
        { code: '救助04', name: '救命ロープ', qty: '1本' },
        { code: '救助05', name: 'ジャッキ', qty: '1台' },
        { code: '救助06', name: '二連はしご', qty: '1台' },
        { code: '救助07', name: 'ボルトクリッパー', qty: '3挺' },
        { code: '救助08', name: '救助工具セット', qty: '1セット' },
        { code: '救助09', name: '工具セット（簡易）', qty: '1セット' },
        { code: '救助10', name: '工具セット（フル）', qty: '1セット' },
        { code: '救助11', name: '担架', qty: '1台' },
        { code: '救助13-2', name: 'ヘルメット', qty: '20個' },
        { code: '救助14', name: 'ハンドマイク', qty: '1台' },
        { code: '救助15', name: 'メガホン', qty: '10個' },
        { code: '救助16', name: 'ホイッスル', qty: '10個' },
        { code: '救助17', name: 'コードリール', qty: '1台' },
        { code: '救助18', name: 'ガソリン', qty: '2缶' },
        { code: '救助19', name: '標識ロープ', qty: '2本' },
        { code: '救助20', name: '規制テープ', qty: '3個' },
        { code: '救助21', name: 'スコップ', qty: '5本' },
        { code: '救助22', name: 'つるはし', qty: '5本' },
        { code: '救助23', name: 'バール（テコ）', qty: '5本' },
        { code: '救助24', name: 'バール（平）', qty: '5本' },
        { code: '救助25', name: 'のこぎり', qty: '5本' },
        { code: '救助26', name: 'おの', qty: '5本' },
        { code: '救助27', name: 'なた', qty: '5本' },
        { code: '救助28', name: 'アッキス', qty: '5本' },
        { code: '救助29', name: '両口ハンマー', qty: '5本' },
        { code: '救助30', name: 'かけや', qty: '5本' },
        { code: '救助31-1', name: '手袋', qty: '5双' },
        { code: '救助31-2', name: '革手袋', qty: '10双' },
        { code: '救助32', name: '防塵マスク（20枚入り）', qty: '5個' },
        { code: '救助33', name: '懐中電灯', qty: '2個' },
        { code: '救助34', name: 'ランタン', qty: '7個' },
      ],
    },
    {
      id: 'food',
      label: '食糧',
      items: [
        // Unity 側データが途中切れのため、判明分のみ
        { code: '食糧01-1', name: '飲料水（500ml）', qty: '24本' },
      ],
    },
  ],
};

/** 説明カード＋収納品を1列のページにする */
export function buildWarehousePages(data = WAREHOUSE) {
  const pages = [];
  for (const step of data.intro) {
    pages.push({ kind: 'intro', title: step.title, body: step.body });
  }
  for (const cat of data.categories) {
    cat.items.forEach((item, i) => {
      pages.push({
        kind: 'item',
        category: cat.label,
        categoryId: cat.id,
        indexInCategory: i + 1,
        categoryTotal: cat.items.length,
        code: item.code,
        name: item.name,
        qty: item.qty,
        key: `${cat.id}:${item.code}`,
      });
    });
  }
  return pages;
}
