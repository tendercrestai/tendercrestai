const {RequestError}=require('./rfp-security');
function billingSource(){
 const test=process.env.CUSTOMER_CARE_TEST_MODE==='true';
 if(test&&process.env.SUPABASE_URL!=='https://wcrrywzleylmdsqqlise.supabase.co')throw new RequestError(503,'Test billing must use the isolated Supabase project.');
 return test?{root:'https://api.airtable.com/v0/appsDmtQ1XOE8Gjtr',company:'Companies',proposals:'Proposals%20Pipeline',pat:process.env.AIRTABLE_TEST_PAT,test:true}:{root:'https://api.airtable.com/v0/appsaqdp3UZdhB2VH',company:'tbliWnP6ThqA02G5L',proposals:'tblkL2ct7mYtUTu9S',pat:process.env.AIRTABLE_PAT,test:false};
}
module.exports={billingSource};
