/**
 * 月历日期选择组件
 *
 * 替换微信原生 picker mode="date"（滚轮式，无法展示「今天」与星期排布）。
 * 提供标准月历视图：星期表头、今天高亮、上/下月切换、一键回到今天。
 *
 * 两种模式：
 *  - single：选单个日期，触发 select 事件 { date: 'YYYY-MM-DD' }
 *  - range ：先选起点再选终点，触发 select 事件 { start, end }
 *
 * 用法：
 *   <date-calendar
 *     show="{{showCalendar}}"
 *     mode="single"
 *     value="{{anchorDate}}"
 *     min-date="{{minDate}}"
 *     max-date="{{maxDate}}"
 *     title="选择日期"
 *     bind:select="onCalendarSelect"
 *     bind:close="onCalendarClose"
 *   />
 *
 * 说明：
 *  - 所有日期均为本地 YYYY-MM-DD 字符串，与页面既有字段格式一致。
 *  - 组件内部使用本地日期计算「今天」，不依赖时区转换。
 *  - 星期表头固定为「日 一 二 三 四 五 六」（周日为首列）。
 */

type CalendarCell = {
  /** 本地 YYYY-MM-DD */
  date: string;
  /** 显示用「日」数字 */
  day: number;
  /** 是否当前展示月之外的填充格 */
  out: boolean;
  /** 是否为今天 */
  today: boolean;
  /** 是否被选中（起点/终点/或单选选中） */
  selected: boolean;
  /** 是否为区间内的中间日期 */
  inRange: boolean;
  /** 是否为区间起点 */
  rangeStart: boolean;
  /** 是否为区间终点 */
  rangeEnd: boolean;
  /** 是否处于 min/max 限制之外（不可选） */
  disabled: boolean;
};

Component({
  properties: {
    /** 是否显示弹层 */
    show: {
      type: Boolean,
      value: false,
      observer(visible: boolean): void {
        if (visible) this.open();
      },
    },
    /** 'single' | 'range' */
    mode: {
      type: String,
      value: 'single',
    },
    /** 单选初始值 / 当前值 YYYY-MM-DD */
    value: {
      type: String,
      value: '',
    },
    /** 区间起点初始值 */
    startValue: {
      type: String,
      value: '',
    },
    /** 区间终点初始值 */
    endValue: {
      type: String,
      value: '',
    },
    /** 可选最小日期 YYYY-MM-DD（含），空串表示不限制 */
    minDate: {
      type: String,
      value: '',
    },
    /** 可选最大日期 YYYY-MM-DD（含），空串表示不限制 */
    maxDate: {
      type: String,
      value: '',
    },
    /** 弹层标题 */
    title: {
      type: String,
      value: '选择日期',
    },
  },

  data: {
    /** 当前展示的年/月（1-12） */
    viewYear: 0,
    viewMonth: 0,
    weekHeader: ['日', '一', '二', '三', '四', '五', '六'],
    cells: [] as CalendarCell[],
    /** range 模式下已选起点，未选终点时的临时起点 */
    pendingStart: '',
    todayText: '',
  },

  methods: {
    /** 打开时定位到初始值所在月份（无初始值则定位今天） */
    open(): void {
      const { mode, value, startValue, endValue } = this.properties as {
        mode: string;
        value: string;
        startValue: string;
        endValue: string;
      };
      const anchor = mode === 'range'
        ? (startValue || endValue || value)
        : (value || '');
      const d = anchor ? parseYmd(anchor) : new Date();
      this.setData({
        viewYear: d.getFullYear(),
        viewMonth: d.getMonth() + 1,
        pendingStart: '',
      });
      this.render();
    },

    onClose(): void {
      this.triggerEvent('close');
    },

    onNoop(): void {
      // 阻止点击面板内容冒泡到遮罩
    },

    onPrevMonth(): void {
      let { viewYear, viewMonth } = this.data;
      viewMonth -= 1;
      if (viewMonth < 1) {
        viewMonth = 12;
        viewYear -= 1;
      }
      this.setData({ viewYear, viewMonth });
      this.render();
    },

    onNextMonth(): void {
      let { viewYear, viewMonth } = this.data;
      viewMonth += 1;
      if (viewMonth > 12) {
        viewMonth = 1;
        viewYear += 1;
      }
      this.setData({ viewYear, viewMonth });
      this.render();
    },

    onToday(): void {
      const now = new Date();
      const today = formatYmd(now);
      this.setData({
        viewYear: now.getFullYear(),
        viewMonth: now.getMonth() + 1,
        pendingStart: '',
      });
      this.render();
      if (this.properties.mode === 'range') {
        // 单选今天作为起点，等待选终点
        this.setData({ pendingStart: today });
        this.render();
      } else {
        this.setData({ pendingStart: '' });
        this.triggerSelect({ date: today });
      }
    },

    onTapCell(e: WechatMiniprogram.TouchEvent): void {
      const date = e.currentTarget.dataset.date as string;
      if (!date) return;
      const mode = this.properties.mode as string;
      const cell = this.data.cells.find((c) => c.date === date);
      if (cell && cell.disabled) return;

      if (mode === 'range') {
        this.handleRangeTap(date);
      } else {
        this.triggerSelect({ date });
      }
    },

    handleRangeTap(date: string): void {
      let { pendingStart } = this.data;
      if (!pendingStart || pendingStart > date) {
        // 第一次选，或后选的更早：将其作为新起点
        pendingStart = date;
        this.setData({ pendingStart });
        this.render();
        return;
      }
      // 已选起点且本次更晚：形成区间
      const start = pendingStart;
      const end = date;
      this.setData({ pendingStart: '' });
      this.triggerSelect({ start, end });
    },

    triggerSelect(payload: { date?: string; start?: string; end?: string }): void {
      this.triggerEvent('select', payload);
    },

    /** 根据当前 viewYear/viewMonth 生成 6×7 网格 */
    render(): void {
      const { viewYear, viewMonth } = this.data;
      const { mode, value, startValue, endValue, minDate, maxDate } = this.properties as {
        mode: string;
        value: string;
        startValue: string;
        endValue: string;
        minDate: string;
        maxDate: string;
      };
      const today = formatYmd(new Date());

      let selStart = '';
      let selEnd = '';
      if (mode === 'range') {
        selStart = startValue || '';
        selEnd = endValue || '';
      } else {
        selStart = value || '';
      }

      const firstDay = new Date(viewYear, viewMonth - 1, 1);
      const startWeekday = firstDay.getDay(); // 0=周日
      const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();

      // 前置填充（上月）
      const cells: CalendarCell[] = [];
      const prevDays = new Date(viewYear, viewMonth - 1, 0).getDate();
      for (let i = startWeekday - 1; i >= 0; i--) {
        const day = prevDays - i;
        const d = new Date(viewYear, viewMonth - 2, day);
        cells.push(this.makeCell(d, true, today, selStart, selEnd, mode, minDate, maxDate));
      }
      // 当月
      for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(viewYear, viewMonth - 1, day);
        cells.push(this.makeCell(d, false, today, selStart, selEnd, mode, minDate, maxDate));
      }
      // 后置填充，补足到整周（至少 42 格 = 6 周）
      let idx = cells.length;
      const nextMonth = viewMonth === 12 ? 1 : viewMonth + 1;
      const nextYear = viewMonth === 12 ? viewYear + 1 : viewYear;
      let dayCounter = 1;
      while (idx < 42) {
        const d = new Date(nextYear, nextMonth - 1, dayCounter);
        cells.push(this.makeCell(d, true, today, selStart, selEnd, mode, minDate, maxDate));
        dayCounter += 1;
        idx += 1;
      }

      this.setData({ cells, todayText: today });
    },

    makeCell(
      d: Date,
      out: boolean,
      today: string,
      selStart: string,
      selEnd: string,
      mode: string,
      minDate: string,
      maxDate: string,
    ): CalendarCell {
      const date = formatYmd(d);
      const { pendingStart } = this.data;
      let disabled = false;
      if (minDate && date < minDate) disabled = true;
      if (maxDate && date > maxDate) disabled = true;

      let selected = false;
      let inRange = false;
      let rangeStart = false;
      let rangeEnd = false;

      if (mode === 'range') {
        const effStart = selStart || pendingStart;
        const effEnd = selEnd;
        if (effStart && effEnd) {
          if (date === effStart) rangeStart = true;
          if (date === effEnd) rangeEnd = true;
          if (date > effStart && date < effEnd) inRange = true;
          selected = rangeStart || rangeEnd;
        } else if (pendingStart && date === pendingStart) {
          selected = true;
          rangeStart = true;
        } else if (effStart && date === effStart) {
          selected = true;
          rangeStart = true;
        }
      } else {
        if (date === selStart) selected = true;
      }

      return {
        date,
        day: d.getDate(),
        out,
        today: date === today,
        selected,
        inRange,
        rangeStart,
        rangeEnd,
        disabled,
      };
    },
  },
});

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
