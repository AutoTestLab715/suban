const { prefetchBiaoxunDetail } = require("../../utils/preload");
const { buildHallCountdown } = require("../../utils/hallCountdown");

Component({
  properties: {
    item: {
      type: Object,
      value: {},
    },
  },
  data: {
    showHallCountdown: false,
    countdown: null,
  },
  observers: {
    item(item) {
      this.setupCountdown(item || {});
    },
  },
  detached() {
    this.clearCountdownTimer();
  },
  methods: {
    clearCountdownTimer() {
      if (this._cdTimer) {
        clearInterval(this._cdTimer);
        this._cdTimer = null;
      }
    },
    setupCountdown(item) {
      this.clearCountdownTimer();
      const sourceCode = String(item.sourceCode || item.source || "")
        .trim()
        .toLowerCase();
      if (sourceCode !== "quanzhou_hall") {
        this.setData({ showHallCountdown: false, countdown: null });
        return;
      }
      this.tickCountdown(item);
      this._cdTimer = setInterval(() => this.tickCountdown(this.data.item || item), 1000);
    },
    tickCountdown(item) {
      const countdown = buildHallCountdown(item || {});
      this.setData({
        showHallCountdown: !!(countdown && countdown.show),
        countdown,
      });
    },
    onTouchStart() {
      const item = this.data.item || {};
      const id = String(item.id || "");
      if (!id) return;
      // 手指按下即预取详情，进入详情页可直接命中缓存
      prefetchBiaoxunDetail(id, item.sourceCode || item.source || "");
    },
    onTap() {
      const item = this.data.item || {};
      this.triggerEvent("open", {
        id: String(item.id || ""),
        source: String(item.sourceCode || item.source || ""),
      });
    },
  },
});
