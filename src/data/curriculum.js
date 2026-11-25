// 统编版（人教社）语文四年级 unit skeleton — the 2026 revision (grades 4-6
// switched to the revised books in autumn 2026). Built from published
// change lists and teaching notes; NOT verified against the book: every unit
// starts with verified = 0 and the parent checks it against the child's own
// textbook (目录, 单元导语, 书末 识字表 / 写字表). Character lists start empty
// on purpose: they come from the child's book (iPad 实况文本 → paste).
export const SEED_UNITS = [
  { volume: "四上", unit: 1, theme: "自然之美", focus: "边读边想象画面，感受自然之美", skill: "extract", genre: "life",
    topics: "自然、风景、四季", lessons: "观潮、现代诗二首、繁星（《走月亮》已移出）" },
  { volume: "四上", unit: 2, theme: "提问", focus: "阅读时尝试从不同的角度去思考，提出自己的问题", skill: "infer", genre: "story",
    topics: "童话、科学、智慧", lessons: "一个豆荚里的五粒豆、夜间飞行的秘密、方帽子店、田忌赛马（新增两篇）" },
  { volume: "四上", unit: 3, theme: "连续细致的观察", focus: "体会文章准确生动的表达，感受作者连续细致的观察", skill: "extract", genre: "science",
    topics: "动物、植物、观察", lessons: "古诗三首、爬山虎的脚、蟋蟀的住宅" },
  { volume: "四上", unit: 4, theme: "神话", focus: "了解故事的起因、经过、结果，学习把握文章的主要内容；感受神话中神奇的想象和鲜明的人物形象", skill: "summarise", genre: "myth",
    topics: "神话、盘古、精卫、普罗米修斯", lessons: "盘古开天地、精卫填海、普罗米修斯（《女娲补天》已移出）；快乐读书吧：很久很久以前" },
  { volume: "四上", unit: 5, theme: "写一件事（习作单元）", focus: "了解作者是怎样把事情写清楚的", skill: "extract", genre: "life",
    topics: "生活、经历", lessons: "麻雀、爬天都峰" },
  { volume: "四上", unit: 6, theme: "中国的世界文化遗产", focus: "（待核对）", skill: "extract", genre: "history",
    topics: "长城、颐和园、兵马俑、文化遗产、历史", lessons: "长城、颐和园、秦兵马俑；口语交际：我是小小讲解员；习作：中国的世界文化遗产" },
  { volume: "四上", unit: 7, theme: "成长", focus: "学习用批注的方法阅读（待核对）", skill: "locate", genre: "story",
    topics: "成长、童年、勇气", lessons: "牛和鹅、一只窝囊的大老虎、陀螺、王戎不取道旁李" },
  { volume: "四上", unit: 8, theme: "家国情怀", focus: "关注主要人物和事件，学习把握文章主要内容（待核对）", skill: "summarise", genre: "history",
    topics: "家国、历史人物、读书", lessons: "古诗三首、为中华之崛起而读书、我将无我，不负人民（新增）" },
];

export const SKILL_OPTIONS = { extract: "信息提取", infer: "推断", summarise: "概括", theme: "道理体会", word: "词语理解", locate: "回文定位" };
