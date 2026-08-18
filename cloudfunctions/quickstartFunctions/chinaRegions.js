/**
 * 全国省 → 地级市（福建继续用 fujianRegions 细到区县）
 */
const { FUJIAN_REGIONS, collectValues } = require("./fujianRegions");

const getFujianCities = () =>
  FUJIAN_REGIONS.map((item) => ({
    name: item.name,
    hasChildren: !!(item.children && item.children.length),
  }));

const getFujianDistricts = (cityName) => {
  const city = FUJIAN_REGIONS.find((item) => item.name === cityName);
  if (!city) return [];
  if (!city.children || !city.children.length) {
    return [{ name: `${cityName}全部`, isAll: true, hasChildren: false }];
  }
  return [
    { name: `${cityName}全部`, isAll: true, hasChildren: false },
    ...city.children.map((item) => ({
      name: item.name,
      hasChildren: false,
      values: collectValues(item),
    })),
  ];
};

const CHINA_REGIONS = [
  {
    name: "北京市",
    children: [
      "东城区", "西城区", "朝阳区", "丰台区", "石景山区", "海淀区", "门头沟区", "房山区",
      "通州区", "顺义区", "昌平区", "大兴区", "怀柔区", "平谷区", "密云区", "延庆区",
    ],
  },
  {
    name: "天津市",
    children: [
      "和平区", "河东区", "河西区", "南开区", "河北区", "红桥区", "东丽区", "西青区",
      "津南区", "北辰区", "武清区", "宝坻区", "滨海新区", "宁河区", "静海区", "蓟州区",
    ],
  },
  {
    name: "上海市",
    children: [
      "黄浦区", "徐汇区", "长宁区", "静安区", "普陀区", "虹口区", "杨浦区", "闵行区",
      "宝山区", "嘉定区", "浦东新区", "金山区", "松江区", "青浦区", "奉贤区", "崇明区",
    ],
  },
  {
    name: "重庆市",
    children: [
      "万州区", "涪陵区", "渝中区", "大渡口区", "江北区", "沙坪坝区", "九龙坡区", "南岸区",
      "北碚区", "綦江区", "大足区", "渝北区", "巴南区", "黔江区", "长寿区", "江津区",
      "合川区", "永川区", "南川区", "璧山区", "铜梁区", "潼南区", "荣昌区", "开州区",
      "梁平区", "武隆区",
    ],
  },
  {
    name: "河北省",
    children: [
      "石家庄市", "唐山市", "秦皇岛市", "邯郸市", "邢台市", "保定市", "张家口市", "承德市",
      "沧州市", "廊坊市", "衡水市",
    ],
  },
  {
    name: "山西省",
    children: [
      "太原市", "大同市", "阳泉市", "长治市", "晋城市", "朔州市", "晋中市", "运城市",
      "忻州市", "临汾市", "吕梁市",
    ],
  },
  {
    name: "辽宁省",
    children: [
      "沈阳市", "大连市", "鞍山市", "抚顺市", "本溪市", "丹东市", "锦州市", "营口市",
      "阜新市", "辽阳市", "盘锦市", "铁岭市", "朝阳市", "葫芦岛市",
    ],
  },
  {
    name: "吉林省",
    children: ["长春市", "吉林市", "四平市", "辽源市", "通化市", "白山市", "松原市", "白城市", "延边朝鲜族自治州"],
  },
  {
    name: "黑龙江省",
    children: [
      "哈尔滨市", "齐齐哈尔市", "鸡西市", "鹤岗市", "双鸭山市", "大庆市", "伊春市", "佳木斯市",
      "七台河市", "牡丹江市", "黑河市", "绥化市", "大兴安岭地区",
    ],
  },
  {
    name: "江苏省",
    children: [
      "南京市", "无锡市", "徐州市", "常州市", "苏州市", "南通市", "连云港市", "淮安市",
      "盐城市", "扬州市", "镇江市", "泰州市", "宿迁市",
    ],
  },
  {
    name: "浙江省",
    children: [
      "杭州市", "宁波市", "温州市", "嘉兴市", "湖州市", "绍兴市", "金华市", "衢州市",
      "舟山市", "台州市", "丽水市",
    ],
  },
  {
    name: "安徽省",
    children: [
      "合肥市", "芜湖市", "蚌埠市", "淮南市", "马鞍山市", "淮北市", "铜陵市", "安庆市",
      "黄山市", "滁州市", "阜阳市", "宿州市", "六安市", "亳州市", "池州市", "宣城市",
    ],
  },
  { name: "福建省", useFujianTree: true },
  {
    name: "江西省",
    children: [
      "南昌市", "景德镇市", "萍乡市", "九江市", "新余市", "鹰潭市", "赣州市", "吉安市",
      "宜春市", "抚州市", "上饶市",
    ],
  },
  {
    name: "山东省",
    children: [
      "济南市", "青岛市", "淄博市", "枣庄市", "东营市", "烟台市", "潍坊市", "济宁市",
      "泰安市", "威海市", "日照市", "临沂市", "德州市", "聊城市", "滨州市", "菏泽市",
    ],
  },
  {
    name: "河南省",
    children: [
      "郑州市", "开封市", "洛阳市", "平顶山市", "安阳市", "鹤壁市", "新乡市", "焦作市",
      "濮阳市", "许昌市", "漯河市", "三门峡市", "南阳市", "商丘市", "信阳市", "周口市",
      "驻马店市", "济源市",
    ],
  },
  {
    name: "湖北省",
    children: [
      "武汉市", "黄石市", "十堰市", "宜昌市", "襄阳市", "鄂州市", "荆门市", "孝感市",
      "荆州市", "黄冈市", "咸宁市", "随州市", "恩施土家族苗族自治州", "仙桃市", "潜江市", "天门市", "神农架林区",
    ],
  },
  {
    name: "湖南省",
    children: [
      "长沙市", "株洲市", "湘潭市", "衡阳市", "邵阳市", "岳阳市", "常德市", "张家界市",
      "益阳市", "郴州市", "永州市", "怀化市", "娄底市", "湘西土家族苗族自治州",
    ],
  },
  {
    name: "广东省",
    children: [
      "广州市", "韶关市", "深圳市", "珠海市", "汕头市", "佛山市", "江门市", "湛江市",
      "茂名市", "肇庆市", "惠州市", "梅州市", "汕尾市", "河源市", "阳江市", "清远市",
      "东莞市", "中山市", "潮州市", "揭阳市", "云浮市",
    ],
  },
  {
    name: "海南省",
    children: [
      "海口市", "三亚市", "三沙市", "儋州市", "五指山市", "琼海市", "文昌市", "万宁市",
      "东方市", "定安县", "屯昌县", "澄迈县", "临高县", "白沙黎族自治县", "昌江黎族自治县",
      "乐东黎族自治县", "陵水黎族自治县", "保亭黎族苗族自治县", "琼中黎族苗族自治县",
    ],
  },
  {
    name: "四川省",
    children: [
      "成都市", "自贡市", "攀枝花市", "泸州市", "德阳市", "绵阳市", "广元市", "遂宁市",
      "内江市", "乐山市", "南充市", "眉山市", "宜宾市", "广安市", "达州市", "雅安市",
      "巴中市", "资阳市", "阿坝藏族羌族自治州", "甘孜藏族自治州", "凉山彝族自治州",
    ],
  },
  {
    name: "贵州省",
    children: [
      "贵阳市", "六盘水市", "遵义市", "安顺市", "毕节市", "铜仁市", "黔西南布依族苗族自治州",
      "黔东南苗族侗族自治州", "黔南布依族苗族自治州",
    ],
  },
  {
    name: "云南省",
    children: [
      "昆明市", "曲靖市", "玉溪市", "保山市", "昭通市", "丽江市", "普洱市", "临沧市",
      "楚雄彝族自治州", "红河哈尼族彝族自治州", "文山壮族苗族自治州", "西双版纳傣族自治州",
      "大理白族自治州", "德宏傣族景颇族自治州", "怒江傈僳族自治州", "迪庆藏族自治州",
    ],
  },
  {
    name: "陕西省",
    children: [
      "西安市", "铜川市", "宝鸡市", "咸阳市", "渭南市", "延安市", "汉中市", "榆林市",
      "安康市", "商洛市",
    ],
  },
  {
    name: "甘肃省",
    children: [
      "兰州市", "嘉峪关市", "金昌市", "白银市", "天水市", "武威市", "张掖市", "平凉市",
      "酒泉市", "庆阳市", "定西市", "陇南市", "临夏回族自治州", "甘南藏族自治州",
    ],
  },
  {
    name: "青海省",
    children: [
      "西宁市", "海东市", "海北藏族自治州", "黄南藏族自治州", "海南藏族自治州",
      "果洛藏族自治州", "玉树藏族自治州", "海西蒙古族藏族自治州",
    ],
  },
  {
    name: "内蒙古自治区",
    children: [
      "呼和浩特市", "包头市", "乌海市", "赤峰市", "通辽市", "鄂尔多斯市", "呼伦贝尔市",
      "巴彦淖尔市", "乌兰察布市", "兴安盟", "锡林郭勒盟", "阿拉善盟",
    ],
  },
  {
    name: "广西壮族自治区",
    children: [
      "南宁市", "柳州市", "桂林市", "梧州市", "北海市", "防城港市", "钦州市", "贵港市",
      "玉林市", "百色市", "贺州市", "河池市", "来宾市", "崇左市",
    ],
  },
  {
    name: "西藏自治区",
    children: ["拉萨市", "日喀则市", "昌都市", "林芝市", "山南市", "那曲市", "阿里地区"],
  },
  {
    name: "宁夏回族自治区",
    children: ["银川市", "石嘴山市", "吴忠市", "固原市", "中卫市"],
  },
  {
    name: "新疆维吾尔自治区",
    children: [
      "乌鲁木齐市", "克拉玛依市", "吐鲁番市", "哈密市", "昌吉回族自治州", "博尔塔拉蒙古自治州",
      "巴音郭楞蒙古自治州", "阿克苏地区", "克孜勒苏柯尔克孜自治州", "喀什地区", "和田地区",
      "伊犁哈萨克自治州", "塔城地区", "阿勒泰地区", "石河子市", "阿拉尔市", "图木舒克市",
      "五家渠市", "北屯市", "铁门关市", "双河市", "可克达拉市", "昆玉市", "胡杨河市",
    ],
  },
  { name: "香港特别行政区", children: [] },
  { name: "澳门特别行政区", children: [] },
];

const findProvince = (name) => CHINA_REGIONS.find((item) => item.name === name);

const provinceShortName = (name) =>
  String(name || "")
    .replace(/(特别行政区|维吾尔自治区|壮族自治区|回族自治区|自治区|省|市)$/g, "")
    .trim();

const getTopRegions = () =>
  CHINA_REGIONS.map((item) => ({
    name: item.name,
    hasChildren: !!(item.useFujianTree || (item.children && item.children.length)),
  }));

const getProvinceChildren = (provinceName) => {
  const province = findProvince(provinceName);
  if (!province) return [];
  if (province.useFujianTree) {
    return [
      { name: `${provinceName}全部`, isAll: true, hasChildren: false },
      ...getFujianCities(),
    ];
  }
  const cities = Array.isArray(province.children) ? province.children : [];
  return [
    { name: `${provinceName}全部`, isAll: true, hasChildren: false },
    ...cities.map((name) => ({ name, hasChildren: false })),
  ];
};

const getRegionChildren = (name) => {
  const text = String(name || "").trim();
  if (!text) return [];
  if (findProvince(text)) return getProvinceChildren(text);
  // 福建地市 → 区县
  const fujianCity = FUJIAN_REGIONS.find((item) => item.name === text);
  if (fujianCity) return getFujianDistricts(text);
  return [];
};

const isFujianCityName = (name) => FUJIAN_REGIONS.some((item) => item.name === name);

const isProvinceName = (name) => !!findProvince(name);

const resolveChinaRegionFilter = (regionName) => {
  const name = String(regionName || "").trim();
  if (!name || name === "全部") return [];

  const aliases = {
    上海: ["上海", "上海市"],
    上海市: ["上海", "上海市"],
    北京: ["北京", "北京市"],
    北京市: ["北京", "北京市"],
    天津: ["天津", "天津市"],
    天津市: ["天津", "天津市"],
    重庆: ["重庆", "重庆市"],
    重庆市: ["重庆", "重庆市"],
  };
  if (aliases[name]) return aliases[name];

  if (name === "福建省" || name === "福建") {
    const all = ["福建省", "福建"];
    FUJIAN_REGIONS.forEach((city) => {
      collectValues(city).forEach((value) => {
        if (!all.includes(value)) all.push(value);
      });
    });
    return all;
  }

  const province = findProvince(name);
  if (province) {
    const values = [name];
    const shortName = provinceShortName(name);
    if (shortName && !values.includes(shortName)) values.push(shortName);
    if (province.useFujianTree) {
      FUJIAN_REGIONS.forEach((city) => {
        collectValues(city).forEach((value) => {
          if (!values.includes(value)) values.push(value);
        });
      });
    } else {
      (province.children || []).forEach((city) => {
        if (!values.includes(city)) values.push(city);
        const shortCity = String(city).replace(/(市|地区|盟)$/g, "");
        if (shortCity && !values.includes(shortCity)) values.push(shortCity);
      });
    }
    return values;
  }

  // 福建地市/区县
  for (const city of FUJIAN_REGIONS) {
    if (city.name === name) return collectValues(city);
    if (name === `${city.name}全部`) return collectValues(city);
    if (Array.isArray(city.values) && city.values.includes(name)) return collectValues(city);
    for (const child of city.children || []) {
      if (child.name === name) return collectValues(child);
      if (Array.isArray(child.values) && child.values.includes(name)) return collectValues(child);
    }
  }

  // 其他省市名：自身 + 去后缀短名，供 IN / LIKE 命中
  const values = [name];
  const shortName = String(name).replace(/(特别行政区|自治州|地区|盟|市|区|县)$/g, "");
  if (shortName && !values.includes(shortName)) values.push(shortName);
  return values;
};

module.exports = {
  CHINA_REGIONS,
  getTopRegions,
  getProvinceChildren,
  getRegionChildren,
  isFujianCityName,
  isProvinceName,
  resolveChinaRegionFilter,
  provinceShortName,
};
