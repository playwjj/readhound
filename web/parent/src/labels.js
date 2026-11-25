export const GENRES = { fable: "寓言", fairy: "童话", myth: "神话传说", story: "故事", science: "科普", history: "历史", poem: "诗歌", life: "生活", idiom: "成语故事" };
export const STATUS = { queued: "排队中", processing: "处理中", flagged: "待复核", ready: "已就绪", rejected: "未通过", retired: "已下架" };
export const LEVEL = ["已打开", "读完正文", "完成今日阅读", "完成复述"];
export const AI_PURPOSE = { screen: "适龄审核", glosses: "生字卡", questions: "出题", skills: "技能题", polyphones: "多音字", story: "写故事", retell: "复述评估", stt: "语音转写" };
export const pct = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
export const hanCount = (s) => [...(s || "")].length;
