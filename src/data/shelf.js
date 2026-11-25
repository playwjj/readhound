// 公版名篇书架: public-domain texts that suit a grade-4 reader, with pages
// verified on zh.wikisource (2026-11-26). Public domain in China = author
// (and translator) died 1975 or earlier. Long chapters are split into parts
// read in order. `fit`: good = about right now; ok = a little hard; hard =
// keep for later (the pipeline still screens every part for this child).
export const SHELF = [
  {
    key: "xiaopo", title: "小坡的生日", author: "老舍", genre: "fairy", fit: "good",
    note: "老舍写给孩子的长篇童话：新加坡小男孩小坡和妹妹仙坡的日常，后半部是一场奇妙的梦（影儿国、猴王、虎山）。句子短、对话多。",
    pages: ["小坡和妹妹", "种族问题", "新年", "花园里", "还在花园里", "上学", "学校里", "逃学", "海岸上", "生日", "电影园中", "嗗拉巴唧", "影儿国", "猴王", "狼猴大战", "求救", "往虎山去", "醒了"].map((c) => `小坡的生日/${c}`),
  },
  {
    key: "aide", title: "爱的教育（开头 7 篇）", author: "亚米契斯 著，夏丏尊 译", genre: "story", fit: "good",
    note: "意大利四年级小学生安利柯一个学年的日记：开学、老师、同学之间的事。和孩子同龄，每篇正好一次读完。（文中“先生”指老师。）",
    pages: ["始業日", "我們的先生", "災難", "格拉伯利亞的小孩", "同窗朋友", "俠義的行為", "我的女先生"].map((c) => `愛的教育/${c}`),
  },
  { key: "luohuasheng", title: "落花生", author: "许地山", genre: "life", fit: "good", note: "五年级上册课文。一家人过收获节，父亲借花生讲做人的道理。", pages: ["落花生"] },
  { key: "hulan3", title: "呼兰河传·祖父的园子", author: "萧红", genre: "life", fit: "good", note: "五年级下册《祖父的园子》出自这一章：童年的“我”和祖父在后花园里。全章较长，分成十来篇按顺序读。", pages: ["呼蘭河傳/第三章"] },
  { key: "chun", title: "春", author: "朱自清", genre: "life", fit: "good", note: "七年级上册课文。写春天的草、花、风、雨，比喻和拟人很多，适合学写景。", pages: ["春 (朱自清)"] },
  { key: "congcong", title: "匆匆", author: "朱自清", genre: "life", fit: "good", note: "六年级下册课文。时间都去哪儿了？短，适合朗读。", pages: ["匆匆"] },
  { key: "chabuduo", title: "差不多先生传", author: "胡适", genre: "story", fit: "good", note: "一个凡事“差不多”的人的有趣小传，读完可以聊聊“认真”。", pages: ["差不多先生傳"] },
  { key: "dongtian", title: "冬天", author: "朱自清", genre: "life", fit: "ok", note: "三个冬天的回忆：和父亲吃白煮豆腐、和朋友夜游、一家人在台州。", pages: ["冬天"] },
  { key: "mao", title: "猫", author: "郑振铎", genre: "life", fit: "ok", note: "七年级上册课文。家里三次养猫的经历，结尾有一段自我反省。", pages: ["貓 (鄭振鐸)"] },
  { key: "beiying", title: "背影", author: "朱自清", genre: "life", fit: "ok", note: "八年级上册课文。车站送别时父亲的背影，写父爱。", pages: ["背影"] },
  { key: "yadexiju", title: "鸭的喜剧", author: "鲁迅", genre: "story", fit: "ok", note: "盲诗人爱罗先珂在北京养蝌蚪、买小鸭的小故事，读来有趣。", pages: ["鴨的喜劇"] },
  { key: "baicaoyuan", title: "从百草园到三味书屋", author: "鲁迅", genre: "life", fit: "ok", note: "七年级上册课文。童年的乐园和私塾。", pages: ["從百草園到三味書屋"] },
  { key: "achang", title: "阿长与《山海经》", author: "鲁迅", genre: "life", fit: "ok", note: "七年级下册课文。保姆阿长给“我”买来《山海经》。", pages: ["阿長與山海經"] },
  { key: "guxiang", title: "故乡（含“少年闰土”）", author: "鲁迅", genre: "story", fit: "hard", note: "六年级上册《少年闰土》出自前半部分。全文是九年级课文，后半较深。", pages: ["故鄉"] },
  { key: "shexi", title: "社戏", author: "鲁迅", genre: "story", fit: "hard", note: "八年级下册课文。少年时和小伙伴夜里划船看戏、偷豆。", pages: ["社戲"] },
  { key: "tuhemao", title: "兔和猫", author: "鲁迅", genre: "story", fit: "hard", note: "院子里一对小白兔的故事，句子偏长。", pages: ["兔和貓"] },
];
