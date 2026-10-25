import { getWebLogin, saveWebLoginEmail } from '../../services/web-login';
import { ensureRuntimeReady } from '../../services/runtime-bootstrap';
Page({
  data:{email:'',originalEmail:'',version:0,loaded:false,loadError:false,submitting:false,available:false,linkStatus:'unlinked'},
  onLoad():void { void this.loadAccount(); },
  async loadAccount():Promise<void> {
    this.setData({loadError:false,loaded:false});
    try {
      await ensureRuntimeReady();
      const account=await getWebLogin();
      this.setData({originalEmail:account.email||'',email:account.email||'',version:account.version,loaded:true,available:account.available!==false,linkStatus:account.status});
    }catch {this.setData({loadError:true});}
  },
  onEmailInput(e:WechatMiniprogram.Input):void {this.setData({email:e.detail.value});},
  async onSave():Promise<void> {
    if(this.data.submitting || !this.data.loaded || !this.data.available) return;
    const email=this.data.email.trim().toLowerCase();
    if(email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      wx.showToast({title:'请输入有效的邮箱地址',icon:'none'});return;
    }
    if(email===this.data.originalEmail) {wx.navigateBack();return;}
    this.setData({submitting:true});
    const confirmed=await new Promise<boolean>(resolve=>wx.showModal({
      title:this.data.originalEmail?'修改绑定邮箱？':'绑定邮箱登录身份？',
      content:`用 ${email} 通过 Web 登录验证后，将关联到当前小程序账号。请确认邮箱属于你。${this.data.originalEmail?'原邮箱对应的这条登录身份将停用。':''}`,
      confirmText:'确认绑定',success:r=>resolve(r.confirm),fail:()=>resolve(false),
    }));
    if(!confirmed){this.setData({submitting:false});return;}
    try {
      const saved=await saveWebLoginEmail(email,this.data.version);
      this.setData({originalEmail:saved.email||'',version:saved.version,linkStatus:saved.status});
      wx.showToast({title:'邮箱已设置',icon:'success'});
      wx.navigateBack({fail:()=>wx.redirectTo({url:'/pages/settings/settings'})});
    }catch(error) {
      const value=error as {code?:string;message?:string};
      if(value.code==='EMAIL_VERSION_CONFLICT') {
        await this.loadAccount();
        wx.showModal({title:'邮箱已更新',content:'请核对最新邮箱后重新操作。',showCancel:false});
      }else {
        wx.showModal({title:'保存失败',content:value.code==='EMAIL_UNAVAILABLE'?'这个邮箱暂不能绑定到当前账号，请使用其他邮箱。':value.message||'请稍后重试',showCancel:false});
      }
    }finally{this.setData({submitting:false});}
  },
});
