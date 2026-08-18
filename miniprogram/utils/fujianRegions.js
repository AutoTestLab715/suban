/**
 * 福建政府采购地区树
 * values: 与 notices.region 字段实际取值对齐，用于服务端 IN 筛选
 */
const { isFlatRegionSource } = require("./infoSources");

const NATIONAL_PROVINCES = [
  "福建省",
  "北京市",
  "天津市",
  "上海市",
  "重庆市",
  "河北省",
  "山西省",
  "辽宁省",
  "吉林省",
  "黑龙江省",
  "江苏省",
  "浙江省",
  "安徽省",
  "江西省",
  "山东省",
  "河南省",
  "湖北省",
  "湖南省",
  "广东省",
  "海南省",
  "四川省",
  "贵州省",
  "云南省",
  "陕西省",
  "甘肃省",
  "青海省",
  "内蒙古自治区",
  "广西壮族自治区",
  "西藏自治区",
  "宁夏回族自治区",
  "新疆维吾尔自治区",
  "香港特别行政区",
  "澳门特别行政区",
];

const getNationalTopRegions = ({ fujianDrillDown = false } = {}) =>
  NATIONAL_PROVINCES.map((name) => ({
    name,
    hasChildren: !!(fujianDrillDown && name === "福建省"),
  }));

const getFujianProvinceChildren = () => [
  { name: "福建省全部", isAll: true, hasChildren: false, selectName: "福建省" },
  ...getTopRegions(),
];

const getRegionOptionsForSource = (source) => {
  const key = String(source || "").trim();
  if (isFlatRegionSource(key)) {
    return getNationalTopRegions({ fujianDrillDown: false });
  }
  return getNationalTopRegions({ fujianDrillDown: true });
};

const expandRegionsForApi = (regions) => {
  const list = Array.isArray(regions) ? regions.filter(Boolean) : [];
  if (!list.length) return [];
  return [...new Set(list.flatMap((name) => resolveRegionFilter(name)))];
};

const FUJIAN_REGIONS = [
  {
    name: "福建省本级",
    values: ["福建省本级", "省本级"],
  },
  {
    name: "平潭综合实验区",
    values: ["平潭综合实验区"],
  },
  {
    name: "福州市",
    children: [
      { name: "福州市本级", values: ["福州市本级"] },
      { name: "鼓楼区", values: ["鼓楼区"] },
      { name: "台江区", values: ["台江区"] },
      { name: "仓山区", values: ["仓山区"] },
      { name: "马尾区", values: ["马尾区"] },
      { name: "晋安区", values: ["晋安区"] },
      { name: "长乐区", values: ["长乐区"] },
      { name: "闽侯县", values: ["闽侯县"] },
      { name: "连江县", values: ["连江县"] },
      { name: "罗源县", values: ["罗源县"] },
      { name: "闽清县", values: ["闽清县"] },
      { name: "永泰县", values: ["永泰县"] },
      { name: "福清市", values: ["福清市"] },
    ],
  },
  {
    name: "厦门市",
    children: [
      { name: "厦门市本级", values: ["厦门市本级"] },
      { name: "思明区", values: ["思明区"] },
      { name: "海沧区", values: ["海沧区"] },
      { name: "湖里区", values: ["湖里区"] },
      { name: "集美区", values: ["集美区"] },
      { name: "同安区", values: ["同安区"] },
      { name: "翔安区", values: ["翔安区"] },
    ],
  },
  {
    name: "莆田市",
    children: [
      { name: "莆田市本级", values: ["莆田市本级"] },
      { name: "城厢区", values: ["城厢区"] },
      { name: "涵江区", values: ["涵江区"] },
      { name: "荔城区", values: ["荔城区"] },
      { name: "秀屿区", values: ["秀屿区"] },
      { name: "仙游县", values: ["仙游县"] },
      { name: "湄洲区", values: ["湄洲区", "湄洲岛管委会"] },
    ],
  },
  {
    name: "三明市",
    children: [
      { name: "三明市本级", values: ["三明市本级"] },
      { name: "三元区", values: ["三元区"] },
      { name: "沙县区", values: ["沙县区"] },
      { name: "明溪县", values: ["明溪县"] },
      { name: "清流县", values: ["清流县"] },
      { name: "宁化县", values: ["宁化县"] },
      { name: "大田县", values: ["大田县"] },
      { name: "尤溪县", values: ["尤溪县"] },
      { name: "将乐县", values: ["将乐县"] },
      { name: "泰宁县", values: ["泰宁县"] },
      { name: "建宁县", values: ["建宁县"] },
      { name: "永安市", values: ["永安市"] },
    ],
  },
  {
    name: "泉州市",
    children: [
      { name: "泉州市本级", values: ["泉州市本级"] },
      { name: "鲤城区", values: ["鲤城区"] },
      { name: "丰泽区", values: ["丰泽区"] },
      { name: "洛江区", values: ["洛江区"] },
      { name: "泉港区", values: ["泉港区"] },
      { name: "惠安县", values: ["惠安县"] },
      { name: "安溪县", values: ["安溪县"] },
      { name: "永春县", values: ["永春县"] },
      { name: "德化县", values: ["德化县"] },
      { name: "石狮市", values: ["石狮市"] },
      { name: "晋江市", values: ["晋江市"] },
      { name: "南安市", values: ["南安市"] },
      { name: "泉州台商投资区", values: ["泉州台商投资区"] },
    ],
  },
  {
    name: "漳州市",
    children: [
      { name: "漳州市本级", values: ["漳州市本级"] },
      { name: "芗城区", values: ["芗城区"] },
      { name: "龙文区", values: ["龙文区"] },
      { name: "龙海区", values: ["龙海区"] },
      { name: "长泰区", values: ["长泰区"] },
      { name: "云霄县", values: ["云霄县"] },
      { name: "漳浦县", values: ["漳浦县"] },
      { name: "诏安县", values: ["诏安县"] },
      { name: "东山县", values: ["东山县"] },
      { name: "南靖县", values: ["南靖县"] },
      { name: "平和县", values: ["平和县"] },
      { name: "华安县", values: ["华安县"] },
      { name: "漳州台商投资区", values: ["漳州台商投资区"] },
      { name: "漳州古雷港经济开发区", values: ["漳州古雷港经济开发区"] },
      { name: "漳州经济开发区", values: ["漳州经济开发区"] },
      { name: "漳州高新区", values: ["漳州高新区"] },
      { name: "常山开发区", values: ["常山开发区"] },
    ],
  },
  {
    name: "南平市",
    children: [
      { name: "南平市本级", values: ["南平市本级"] },
      { name: "延平区", values: ["延平区"] },
      { name: "建阳区", values: ["建阳区"] },
      { name: "顺昌县", values: ["顺昌县"] },
      { name: "浦城县", values: ["浦城县"] },
      { name: "光泽县", values: ["光泽县"] },
      { name: "松溪县", values: ["松溪县"] },
      { name: "政和县", values: ["政和县"] },
      { name: "邵武市", values: ["邵武市"] },
      { name: "武夷山市", values: ["武夷山市"] },
      { name: "建瓯市", values: ["建瓯市"] },
    ],
  },
  {
    name: "龙岩市",
    children: [
      { name: "龙岩市本级", values: ["龙岩市本级"] },
      { name: "新罗区", values: ["新罗区"] },
      { name: "永定区", values: ["永定区"] },
      { name: "长汀县", values: ["长汀县"] },
      { name: "上杭县", values: ["上杭县"] },
      { name: "武平县", values: ["武平县"] },
      { name: "连城县", values: ["连城县"] },
      { name: "漳平市", values: ["漳平市"] },
    ],
  },
  {
    name: "宁德市",
    children: [
      { name: "宁德市本级", values: ["宁德市本级"] },
      { name: "蕉城区", values: ["蕉城区"] },
      { name: "霞浦县", values: ["霞浦县"] },
      { name: "古田县", values: ["古田县"] },
      { name: "屏南县", values: ["屏南县"] },
      { name: "寿宁县", values: ["寿宁县"] },
      { name: "周宁县", values: ["周宁县"] },
      { name: "柘荣县", values: ["柘荣县"] },
      { name: "福安市", values: ["福安市"] },
      { name: "福鼎市", values: ["福鼎市"] },
      { name: "东侨经济技术开发区", values: ["东侨经济技术开发区", "东侨区"] },
    ],
  },
];

const collectValues = (node) => {
  if (!node) return [];
  if (Array.isArray(node.values) && node.values.length) return [...node.values];
  const result = [];
  (node.children || []).forEach((child) => {
    collectValues(child).forEach((value) => {
      if (!result.includes(value)) result.push(value);
    });
  });
  return result;
};

const getTopRegions = () =>
  FUJIAN_REGIONS.map((item) => ({
    name: item.name,
    hasChildren: !!(item.children && item.children.length),
    values: collectValues(item),
  }));

const getRegionChildren = (cityName) => {
  const city = FUJIAN_REGIONS.find((item) => item.name === cityName);
  if (!city || !city.children) return [];
  return [
    {
      name: `${cityName}全部`,
      isAll: true,
      values: collectValues(city),
    },
    ...city.children.map((item) => ({
      name: item.name,
      hasChildren: false,
      values: collectValues(item),
    })),
  ];
};

const resolveRegionFilter = (regionName) => {
  const name = String(regionName || "").trim();
  if (!name || name === "全部") return [];

  const REGION_ALIASES = {
    上海: ["上海", "上海市"],
    上海市: ["上海", "上海市"],
    江苏: ["江苏", "江苏省"],
    江苏省: ["江苏", "江苏省"],
    北京: ["北京", "北京市"],
    北京市: ["北京", "北京市"],
    天津: ["天津", "天津市"],
    天津市: ["天津", "天津市"],
    重庆: ["重庆", "重庆市"],
    重庆市: ["重庆", "重庆市"],
  };
  if (REGION_ALIASES[name]) return REGION_ALIASES[name];

  if (name === "福建省" || name === "福建") {
    const all = ["福建省", "福建"];
    FUJIAN_REGIONS.forEach((city) => {
      collectValues(city).forEach((value) => {
        if (!all.includes(value)) all.push(value);
      });
    });
    return all;
  }

  for (const city of FUJIAN_REGIONS) {
    if (city.name === name) return collectValues(city);
    if (city.name && name === `${city.name}全部`) return collectValues(city);
    if (Array.isArray(city.values) && city.values.includes(name)) return collectValues(city);
    for (const child of city.children || []) {
      if (child.name === name) return collectValues(child);
      if (Array.isArray(child.values) && child.values.includes(name)) return collectValues(child);
    }
  }
  return [name];
};

module.exports = {
  FUJIAN_REGIONS,
  NATIONAL_PROVINCES,
  getTopRegions,
  getRegionChildren,
  getFujianProvinceChildren,
  getNationalTopRegions,
  getRegionOptionsForSource,
  resolveRegionFilter,
  expandRegionsForApi,
  collectValues,
};
