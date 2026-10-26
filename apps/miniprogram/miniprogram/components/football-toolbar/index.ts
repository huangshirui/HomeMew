/** One mobile football navigation language, below the system capsule row. */
Component({
  properties:{mode:{type:String,value:'record'},people:{type:Array,value:[]},personIndex:{type:Number,value:0},filterOpen:{type:Boolean,value:false},hasFilters:{type:Boolean,value:false}},
  methods:{
    onMode(e:WechatMiniprogram.TouchEvent):void{this.triggerEvent('mode',{mode:e.currentTarget.dataset.mode});},
    onPerson(e:WechatMiniprogram.CustomEvent<{value:string}>):void{this.triggerEvent('person',e.detail);},
    onAction(e:WechatMiniprogram.TouchEvent):void{this.triggerEvent(String(e.currentTarget.dataset.action));},
  },
});
