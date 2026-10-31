/**
 * 日程详情页
 *
 * 展示日程完整信息并支持编辑、删除（任意有效家庭成员均可操作）。
 * 删除与版本冲突遵循 SPEC 9.7、9.8。
 */

import { getEvent, deleteEvent } from '../../services/events';
import {
  showError,
  showSuccess,
  showLoading,
  hideLoading,
  showConfirm,
  getErrorMessage,
  isVersionConflict,
  formatDate,
  parseDateOnly,
  formatDateOnly,
  addDaysToDateOnly,
  formatInstantInTimeZone,
  timeZoneLabel,
} from '../../utils/index';
import { getViewingTimeZone } from '../../services/settings';
import { Event } from '../../types/index';
import { markDirty } from '../../stores/dirty';
import { currentFamilyStore, familiesStore } from '../../stores/index';
import { ensureRuntimeReady } from '../../services/runtime-bootstrap';
import { AutoRefreshGate } from '../../services/refresh-policy';
import { setCloneSource } from '../../stores/clone-buffer';
import { downloadRecordIconImage } from '../../services/record-icons';
import { wgs84ToGcj02 } from '../../utils/map-coordinates';

Page({
  data: {
    familyId: '',
    eventId: '',
    event: null as Event | null,
    /** 视图层使用的派生字段 */
    summary: '',
    iconEmoji: '',
    iconImagePath: '',
    description: '',
    isAllDay: false,
    dateText: '',
    timeText: '',
    location: '',
    locationText: '无',
    locationClickable: false,
    attendeeNames: '',
    createdByText: '',
    createdBySystem: false,
    updatedByText: '',
    updatedBySystem: false,
    createdAtText: '',
    updatedAtText: '',
    loaded: false,
    deleting: false,
  },

  _refreshGate: new AutoRefreshGate(),

  async onLoad(options: { id?: string; familyId?: string }): Promise<void> {
    const eventId = options?.id;
    const familyId = options?.familyId;
    if (!eventId || !familyId) {
      showError('缺少日程参数');
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    // 补全运行时上下文（用户/家庭/时区），失败也不阻塞详情加载（请求层会自动登录）
    try {
      await ensureRuntimeReady();
    } catch (error) {
      console.error('[EventDetail] Runtime bootstrap failed:', error);
    }
    this.setData({ eventId, familyId });
    this.loadEvent();
  },

  onShow(): void {
    if (this.data.loaded && this._refreshGate.shouldRefresh(`events:${this.data.familyId}:${this.data.eventId}`,'events',Boolean(this.data.event))) this.loadEvent();
  },

  async loadEvent(): Promise<void> {
    this._refreshGate.noteRequest(`events:${this.data.familyId}:${this.data.eventId}`,'events');
    try {
      const event = await getEvent(this.data.familyId, this.data.eventId);
      this.applyEvent(event);
    } catch (error: unknown) {
      console.error('[EventDetail] Load failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message) || '日程加载失败');
      this.setData({ loaded: true });
    }
  },

  applyEvent(event: Event): void {
    const isAllDay = event.isAllDay;
    let dateText = '';
    let timeText = '';
    if (isAllDay) {
      const startStr = formatDateOnly(parseDateOnly(event.startDate));
      const inclusiveEndStr = addDaysToDateOnly(event.endDateExclusive, -1);
      dateText = startStr === inclusiveEndStr
        ? formatDate(startStr, 'date')
        : `${formatDate(startStr, 'date')} 至 ${formatDate(inclusiveEndStr, 'date')}`;
      timeText = '全天';
    } else {
      const familyTimeZone =
        currentFamilyStore.value?.timezone
        || familiesStore.value.find(family => family.id === this.data.familyId)?.timezone;
      // 日期与主时间使用查看时区（跟随用户时区设置），与日程列表的归组保持一致
      const viewingTimezone = getViewingTimeZone(familyTimeZone);
      const start = formatInstantInTimeZone(event.startAt, viewingTimezone);
      const end = formatInstantInTimeZone(event.endAt, viewingTimezone);
      dateText = start.date === end.date
        ? start.date
        : `${start.date} 至 ${end.date}`;
      timeText = `${start.time} - ${end.time}`;
      // 端点地点时区（如航班出发地 / 到达地）仅作为附加标签展示
      const startZone = event.startTimezone;
      const endZone = event.endTimezone;
      if (
        (startZone && startZone !== viewingTimezone)
        || (endZone && endZone !== viewingTimezone)
      ) {
        const originZone = startZone || viewingTimezone;
        const arrivalZone = endZone || viewingTimezone;
        const atOrigin = formatInstantInTimeZone(event.startAt, originZone);
        const atArrival = formatInstantInTimeZone(event.endAt, arrivalZone);
        timeText += ` · ${timeZoneLabel(originZone)} ${atOrigin.time} → ${timeZoneLabel(arrivalZone)} ${atArrival.time}`;
      }
    }
    const attendees = event.attendees || [];
    this.setData({
      event,
      summary: event.summary,
      iconEmoji: event.presentation?.icon?.type === 'emoji' ? event.presentation.icon.value : '',
      iconImagePath: '',
      description: event.description || '',
      isAllDay,
      dateText,
      timeText,
      location: event.location || '',
      locationText: event.location ? event.location : '无',
      locationClickable: Boolean(event.location),
      attendeeNames: attendees.length ? attendees.map(a => a.displayName).join('、') : '未指定',
      createdByText: event.createdBy?.name || '',
      createdBySystem: event.createdBy?.type === 'system',
      updatedByText: event.updatedBy?.name || '',
      updatedBySystem: event.updatedBy?.type === 'system',
      createdAtText: formatDate(event.createdAt, 'datetime'),
      updatedAtText: formatDate(event.updatedAt, 'datetime'),
      loaded: true,
    });
    if (event.presentation?.icon?.type === 'image') {
      const fileId = event.presentation.icon.fileId;
      void downloadRecordIconImage(this.data.familyId, 'event', event.id, fileId)
        .then(iconImagePath => {
          if (this.data.event?.id === event.id && this.data.event?.presentation?.icon?.type === 'image'
            && this.data.event.presentation.icon.fileId === fileId) this.setData({ iconImagePath });
        }).catch(() => undefined);
    }
  },

  onOpenLocation(): void {
    const event=this.data.event;
    if(!event?.location)return;
    const point=event.locationDetail?.coordinates;
    if(!point) {
      wx.showActionSheet({itemList:['复制地点名称'],success:res=>{
        if(res.tapIndex===0)wx.setClipboardData({data:event.location || ''});
      }});
      return;
    }
    const gcj=wgs84ToGcj02(point.latitude,point.longitude);
    wx.openLocation({latitude:gcj.latitude,longitude:gcj.longitude,
      name:event.location,address:event.locationDetail?.address || '',scale:16,
      fail:()=>wx.showToast({title:'地图无法打开，请稍后重试',icon:'none'})});
  },

  onEdit(): void {
    if (!this.data.event) return;
    wx.navigateTo({
      url: `/pages/events/edit?familyId=${this.data.familyId}&id=${this.data.event.id}`,
    });
  },

  /** 复制：保留源日程字段，跳转到创建页预填（日期顺延一天作为默认值） */
  onClone(): void {
    const event = this.data.event;
    if (!event) return;
    setCloneSource(event);
    wx.navigateTo({
      url: `/pages/events/edit?familyId=${this.data.familyId}&clone=1`,
    });
  },

  async onDelete(): Promise<void> {
    const event = this.data.event;
    if (!event || this.data.deleting) return;
    const confirmed = await showConfirm('删除日程', `确定要删除「${event.summary}」吗？`);
    if (!confirmed) return;
    this.setData({ deleting: true });
    showLoading('删除中...');
    try {
      await deleteEvent(this.data.familyId, event.id, event.version);
      hideLoading();
      showSuccess('已删除');
      markDirty('events');
      setTimeout(() => wx.navigateBack(), 800);
    } catch (error: unknown) {
      hideLoading();
      this.setData({ deleting: false });
      console.error('[EventDetail] Delete failed:', error);
      const err = error as { code?: string; message?: string };
      if (isVersionConflict(err.code)) {
        showError(getErrorMessage(err.code) || '内容已被其他家庭成员修改，请刷新后重试');
        this.loadEvent();
        return;
      }
      showError(getErrorMessage(err.code, err.message) || '删除失败，请重试');
    }
  },
});
