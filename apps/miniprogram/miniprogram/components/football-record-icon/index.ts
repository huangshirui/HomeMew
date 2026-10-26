import { downloadRecordIconImage } from '../../services/record-icons';
import type { DomainIcon } from '../../services/domains';
Component({
  options:{pureDataPattern:/^_/},
  properties:{familyId:{type:String,value:''},recordId:{type:String,value:''},icon:{type:Object,value:{} as Partial<DomainIcon>}},
  data:{path:'',_generation:0},
  observers:{'familyId,recordId,icon':function():void{void this.refresh();}},
  methods:{async refresh():Promise<void>{
    const generation=++this.data._generation;this.setData({path:''});const {familyId,recordId,icon}=this.properties;
    if(icon?.type!=='image'||!familyId||!recordId)return;
    try{const path=await downloadRecordIconImage(familyId,'person_group',recordId,icon.fileId);if(generation===this.data._generation)this.setData({path});}catch{}
  }},
});
