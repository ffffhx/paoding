export const TECHNIQUE_TERMS = [
  { technique: "焯水", aliases: ["焯水", "飞水", "汆水", "汆烫", "汆一下"] },
  { technique: "滑油", aliases: ["滑油", "过油", "走油"] },
  { technique: "炝锅", aliases: ["炝锅", "爆锅", "葱姜蒜爆香"] },
  { technique: "爆香", aliases: ["爆香", "煸香", "炒香"] },
  { technique: "收汁", aliases: ["收汁", "大火收", "收浓", "收干"] },
  { technique: "上浆", aliases: ["上浆", "抓浆", "挂浆"] },
  { technique: "腌制", aliases: ["腌制", "腌一下", "腌入味", "码味"] },
  { technique: "煸炒", aliases: ["煸炒", "干煸", "煸出", "煸香"] },
  { technique: "翻炒", aliases: ["翻炒", "快炒", "炒匀"] },
  { technique: "煎制", aliases: ["煎制", "煎到", "煎至", "两面金黄"] },
  { technique: "炸制", aliases: ["炸制", "油炸", "复炸", "炸至"] },
  { technique: "蒸制", aliases: ["蒸制", "上锅蒸", "隔水蒸", "蒸熟"] },
  { technique: "炖煮", aliases: ["炖煮", "慢炖", "小火炖", "炖到"] },
  { technique: "焖", aliases: ["焖", "焖煮", "盖盖焖", "焖熟"] },
  { technique: "红烧", aliases: ["红烧", "烧入味", "烧至"] },
  { technique: "勾芡", aliases: ["勾芡", "水淀粉", "芡汁", "薄芡", "勾薄芡"] },
  { technique: "挂糊", aliases: ["挂糊", "裹糊", "脆皮糊"] },
  { technique: "裹粉", aliases: ["裹粉", "拍粉", "蘸粉"] },
  { technique: "去腥", aliases: ["去腥", "去膻", "去腥味"] },
  { technique: "断生", aliases: ["断生", "炒断生", "刚断生"] },
  { technique: "过冷水", aliases: ["过冷水", "过凉", "冰水", "投凉"] },
  { technique: "泡发", aliases: ["泡发", "泡软", "提前泡"] },
  { technique: "去皮", aliases: ["去皮", "剥皮", "撕皮"] },
  { technique: "切配", aliases: ["切片", "切丝", "切丁", "切块", "切碎", "切末", "切成", "改刀"] },
  { technique: "拍松", aliases: ["拍松", "拍散", "拍裂", "拍碎", "拍黄瓜", "压扁"] },
  { technique: "拌匀", aliases: ["拌匀", "抓匀", "翻拌", "拌入味", "抄底"] },
  { technique: "揉面", aliases: ["揉面", "和面", "揉成团", "揉光滑"] },
  { technique: "醒发", aliases: ["醒发", "醒面", "饧面", "发酵", "松弛面团", "醒一会"] },
  { technique: "擀制", aliases: ["擀制", "擀面", "擀皮", "擀面皮", "擀成薄片", "擀薄"] },
  { technique: "烙", aliases: ["烙", "烙饼", "干烙"] },
  { technique: "烤", aliases: ["烤", "烤箱", "空气炸锅"] },
  { technique: "糖色", aliases: ["糖色", "炒糖色", "焦糖色"] },
  { technique: "炒出汁", aliases: ["炒出汁", "炒出汤汁", "炒出红汁", "炒出沙", "炒到出沙"] },
  { technique: "淋蛋成花", aliases: ["淋入蛋液", "倒入蛋液", "蛋花", "打出蛋花", "形成蛋花", "成流线状倒入"] },
  { technique: "卤制", aliases: ["卤制", "卤煮", "卤水", "卤汁", "卤锅", "老卤"] },
  { technique: "浸泡入味", aliases: ["浸泡入味", "泡在卤汁", "泡在卤水", "泡在料汁", "泡一夜", "泡至少"] },
  { technique: "乳化", aliases: ["乳化", "搅打乳化", "油水融合"] },
  { technique: "调味", aliases: ["调味", "调咸淡", "补盐", "加盐"] },
  { technique: "淋油", aliases: ["淋油", "热油泼", "泼油"] },
  { technique: "拔丝", aliases: ["拔丝", "拉丝", "挂糖"] },
  { technique: "冷藏定型", aliases: ["冷藏定型", "冰箱冷藏", "定型"] },
  { technique: "撇沫", aliases: ["撇沫", "撇去浮沫", "打去浮沫"] },
  { technique: "小火慢煮", aliases: ["小火慢煮", "小火慢熬", "慢煮"] },
  { technique: "大火快炒", aliases: ["大火快炒", "旺火快炒", "猛火快炒"] },
];

function stepText(step) {
  const w = step?.why || {};
  return [
    step?.title,
    step?.action,
    w.reason,
    w.if_not,
    w.cue,
  ].filter(Boolean).join(" ").toLowerCase();
}

export function extractTechniques(recipe) {
  const hits = [];
  const recipeId = recipe?.id || recipe?.recipeId || "";
  const steps = Array.isArray(recipe?.steps) ? recipe.steps : [];
  steps.forEach((step, i) => {
    const text = stepText(step);
    if (!text) return;
    const seen = new Set();
    for (const item of TECHNIQUE_TERMS) {
      if (seen.has(item.technique)) continue;
      if (item.aliases.some((alias) => text.includes(alias.toLowerCase()))) {
        seen.add(item.technique);
        hits.push({ technique: item.technique, recipeId, stepIndex: Number(step.index) || i + 1 });
      }
    }
  });
  return hits;
}
