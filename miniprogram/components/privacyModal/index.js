const { openPrivacyPage } = require("../../utils/privacy");

Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: "隐私保护提示" },
    content: { type: String, value: "" },
  },

  methods: {
    noop() {},
    openFullPolicy() {
      openPrivacyPage();
    },
    onAccept() {
      this.triggerEvent("accept");
    },
    onReject() {
      this.triggerEvent("reject");
    },
  },
});
