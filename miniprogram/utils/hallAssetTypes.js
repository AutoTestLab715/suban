/**
 * 泉州竞价大厅标的类型
 * 选项与详情正文「标的类型」字段取值一致
 */
const buildHallAssetType = (key, label) => ({
  key,
  label,
  keywords: [`标的类型 ${label}`, `标的类型</th><td>${label}</td>`],
});

const HALL_ASSET_TYPES = [
  buildHallAssetType("fangwu", "房屋"),
  buildHallAssetType("nongcun_jiti", "农村集体经营性资产"),
  buildHallAssetType("jidongche", "机动车"),
  buildHallAssetType("shiwu_fangchan", "实物房产"),
  buildHallAssetType("huowu_fuwu", "货物和服务采购"),
  buildHallAssetType("huwai_guanggao", "户外广告"),
  buildHallAssetType("tudi_jingying", "农村土地经营权"),
  buildHallAssetType("shifang", "石方资源"),
  buildHallAssetType("jixie", "机械设备"),
  buildHallAssetType("feijiu", "废旧物资"),
  buildHallAssetType("qita", "其他资产"),
  buildHallAssetType("guoyou_guapai", "国有挂牌项目"),
  buildHallAssetType("zhaoshang", "招商"),
  buildHallAssetType("gongcheng", "工程建设项目采购"),
  buildHallAssetType("tudi", "土地"),
];

const HALL_ASSET_TYPE_OPTIONS = [{ key: "all", label: "全部" }, ...HALL_ASSET_TYPES];

module.exports = {
  HALL_ASSET_TYPES,
  HALL_ASSET_TYPE_OPTIONS,
};
