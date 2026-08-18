const DEVICE_KEY = "formDeviceId";

const getDeviceId = () => {
  let id = wx.getStorageSync(DEVICE_KEY);
  if (!id) {
    id = `d_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    wx.setStorageSync(DEVICE_KEY, id);
  }
  return id;
};

module.exports = { getDeviceId };
