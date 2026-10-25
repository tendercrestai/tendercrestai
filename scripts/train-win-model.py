"""Offline logistic candidate training/evaluation. Never deploys or approves a model."""
import argparse,json,math,pathlib,datetime,hashlib,os
FEATURES=['eligibility','technical','pastPerformance','readiness','commercial']
def sigmoid(z):return 1/(1+math.exp(-max(-40,min(40,z))))
def metrics(rows,beta):
 predictions=[sigmoid(beta[0]+sum(beta[i+1]*r['features'][k] for i,k in enumerate(FEATURES))) for r in rows];ys=[int(r['outcome']=='won') for r in rows];n=len(rows);bins=[]
 for i in range(5):
  ids=[j for j,p in enumerate(predictions) if i/5<=p<((i+1)/5) or (i==4 and p==1)]
  if not ids:continue
  size=len(ids);rate=sum(ys[j] for j in ids)/size;mean=sum(predictions[j] for j in ids)/size;z=1.96;den=1+z*z/size;center=(rate+z*z/(2*size))/den;half=z*math.sqrt(rate*(1-rate)/size+z*z/(4*size*size))/den
  bins.append({'lower':i/5,'upper':(i+1)/5,'records':size,'meanPrediction':mean,'observedRate':rate,'observedRateInterval95':[max(0,center-half),min(1,center+half)]})
 return {'brier':sum((p-y)**2 for p,y in zip(predictions,ys))/n,'logLoss':-sum(y*math.log(max(1e-9,p))+(1-y)*math.log(max(1e-9,1-p)) for p,y in zip(predictions,ys))/n,'calibrationError':sum(b['records']*abs(b['meanPrediction']-b['observedRate']) for b in bins)/n,'calibrationBins':bins}
def main():
 ap=argparse.ArgumentParser();ap.add_argument('dataset');ap.add_argument('output');ap.add_argument('--allow-synthetic-for-tests',action='store_true');args=ap.parse_args();source=pathlib.Path(args.dataset);assert source.stat().st_size<=50*1024*1024,'Dataset exceeds offline capacity';data=json.loads(source.read_text());rows=data['records'];assert len(rows)<=50000
 for r in rows:
  assert r['verifiedOutcome'] is True and r['modelingConsent'] is True and r['outcome'] in ['won','lost'],'Verified, consented wins AND losses required'
  assert args.allow_synthetic_for_tests or r.get('synthetic') is not True,'Synthetic records cannot produce a production candidate'
  dates=[datetime.datetime.fromisoformat(r[name].replace('Z','+00:00')) for name in ['predictorsRecordedAt','submittedAt','outcomeKnownAt']];assert all(d.tzinfo for d in dates),'Use explicit timezones';r['_submittedEpoch']=dates[1].timestamp();assert dates[0]<=dates[1]<dates[2],'Post-outcome or post-submission feature leakage'
  assert r['outcomeProofUrl'].startswith('https://') and r['procurementId']
  assert set(r['features'])==set(FEATURES) and all(type(v) in [int,float] and math.isfinite(v) and 0<=v<=1 for v in r['features'].values())
 assert len({r['id'] for r in rows})==len(rows),'Duplicate records';scopes={(r['market'],r['sector']) for r in rows};assert len(scopes)==1,'Train one validated market/sector at a time'
 groups=sorted({r['procurementId'] for r in rows},key=lambda g:max(r['_submittedEpoch'] for r in rows if r['procurementId']==g));cut=max(1,int(len(groups)*0.7));first=set(groups[:cut]);train=[r for r in rows if r['procurementId'] in first];test=[r for r in rows if r['procurementId'] not in first];assert train and test and max(r['_submittedEpoch'] for r in train)<min(r['_submittedEpoch'] for r in test),'A strict temporal procurement-separated holdout is required'
 tw=sum(r['outcome']=='won' for r in train);ew=sum(r['outcome']=='won' for r in test);floor=len(train)>=200 and tw>=50 and len(train)-tw>=50 and len(test)>=100 and ew>=30 and len(test)-ew>=30
 output=pathlib.Path(args.output);output.mkdir(mode=0o700);base={'modelDeployed':False,'approval':{'status':'pending','independentReview':False},'trainingRecords':len(train),'evaluationRecords':len(test),'dataSHA256':hashlib.sha256(source.read_bytes()).hexdigest()}
 if not floor:(output/'report.json').write_text(json.dumps({**base,'status':'blocked_insufficient_verified_class_coverage'},indent=2));print('Blocked: insufficient verified training/holdout class coverage. No model trained.');return
 prevalence=tw/len(train);beta=[math.log(prevalence/(1-prevalence))]+[0.0]*5;baseline=beta[:]
 for epoch in range(700):
  gradient=[0.0]*6
  for r in train:
   x=[1.0]+[r['features'][k] for k in FEATURES];error=sigmoid(sum(a*b for a,b in zip(beta,x)))-int(r['outcome']=='won')
   for i in range(6):gradient[i]+=error*x[i]
  for i in range(6):beta[i]-=0.25*(gradient[i]/len(train)+(0.01*beta[i] if i else 0))
 measured=metrics(test,beta);constant=metrics(test,baseline);scope=next(iter(scopes));evaluation={**measured,'baselineBrier':constant['brier'],'baselineLogLoss':constant['logLoss'],'records':len(test),'won':ew,'lost':len(test)-ew,'temporalHoldout':True,'procurementSeparated':True};passed=measured['brier']<constant['brier'] and measured['logLoss']<constant['logLoss'] and measured['calibrationError']<=0.10
 candidate={**base,'id':'win-model-candidate','version':'1','type':'logistic-win-v1','features':FEATURES,'coefficients':beta,'market':scope[0],'sector':scope[1],'training':{'records':len(train),'won':tw,'lost':len(train)-tw,'verifiedOutcomes':True,'preSubmissionFeatures':True,'synthetic':any(r.get('synthetic') for r in rows)},'evaluation':evaluation,'expiresAt':(datetime.date.today()+datetime.timedelta(days=90)).isoformat(),'status':'candidate_requires_independent_review' if passed else 'failed_evaluation','notice':'Operational sample floors and held-out metrics do not prove future calibration. Independent provenance/rights review and future-market monitoring are required. Synthetic runs are permanently ineligible for production.'}
 (output/'candidate.json').write_text(json.dumps(candidate,indent=2));os.chmod(output/'candidate.json',0o600);print(json.dumps({'status':candidate['status'],'trainingRecords':len(train),'evaluationRecords':len(test),'modelDeployed':False}))
if __name__=='__main__':main()
