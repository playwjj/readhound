// Surprise chest contents (§8 即时层). Small, random, delightful.
export const ACCESSORIES = [
  { code: "acc:scarf", title: "红围巾" },
  { code: "acc:hat", title: "侦探帽" },
  { code: "acc:glasses", title: "圆眼镜" },
  { code: "acc:bow", title: "蝴蝶结" },
  { code: "acc:cape", title: "小披风" },
  { code: "acc:badge", title: "警长徽章" },
  { code: "acc:backpack", title: "探险背包" },
  { code: "acc:headphones", title: "听书耳机" },
  { code: "acc:magnifier", title: "放大镜" },
  { code: "acc:crown", title: "汉字小王冠" },
];

export const FACTS = [
  "蜗牛有成千上万颗小牙齿，都长在舌头上。",
  "章鱼有三颗心脏，血液是蓝色的。",
  "蜂鸟是唯一能倒着飞的鸟。",
  "长颈鹿的舌头是紫黑色的，长约半米。",
  "北极熊的毛其实是透明的，皮肤是黑色的。",
  "狗的鼻纹和人的指纹一样，每只都不同。",
  "猎犬的鼻子里有大约三亿个嗅觉细胞，人只有几百万个。",
  "“森”字由三个“木”组成——树多了就成了森林。",
  "“休”字是一个人靠在树旁，意思就是休息。",
  "“明”字左边太阳、右边月亮，日月放在一起就很亮。",
  "竹子是草，不是树，有的一天能长将近一米。",
  "海獭睡觉时会手拉手，防止自己漂走。",
  "企鹅的膝盖藏在羽毛里，其实它们有腿。",
  "金鱼的记忆远不止七秒，能记住好几个月。",
  "“尖”字上小下大，正好画出了尖尖的样子。",
  "地球上的蚂蚁加起来，比所有人加起来还重得多。",
];

export const JOKES = [
  "小猎犬问：为什么书总是很累？——因为它们一直被翻来翻去！",
  "铅笔对橡皮说：你真是我的好朋友，总帮我改错。",
  "数学书为什么不开心？——因为它有太多问题了。",
  "小鱼问大鱼：海水为什么是咸的？大鱼说：因为鱼都在里面哭鼻子……开玩笑啦！",
  "小猎犬去图书馆，馆员说：这里不许叫。小猎犬小声说：汪……我是来找字的。",
  "老师：“一”字怎么写？小明画了一横。老师：“十”呢？小明：老师，我再多画几笔就能写到“千”啦！",
  "月亮为什么不会饿？——因为它天天都在吃“月饼”。",
  "小狗为什么喜欢读书？——因为书里有很多“汪”字辈的故事！",
];

/** Pick a surprise deterministically from a seed, skipping owned accessories. */
export function openChest(seed, owned) {
  const r = Math.abs(seed) % 100;
  const freeAcc = ACCESSORIES.filter((a) => !owned.has(a.code));
  if (r < 25 && freeAcc.length) {
    const a = freeAcc[seed % freeAcc.length];
    return { kind: "accessory", code: a.code, title: a.title, text: `小猎犬得到了新配饰：${a.title}！` };
  }
  if (r < 65) return { kind: "fact", text: FACTS[seed % FACTS.length] };
  return { kind: "joke", text: JOKES[seed % JOKES.length] };
}
