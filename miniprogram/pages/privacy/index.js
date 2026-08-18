const { SECTIONS, CONTACT } = require("../../utils/privacyPolicy");

Page({
  data: {
    brand: CONTACT.brand,
    sections: SECTIONS,
    updatedAt: "2026年7月8日",
  },

  callService() {
    wx.makePhoneCall({
      phoneNumber: CONTACT.phone,
      fail: () => {},
    });
  },
});
