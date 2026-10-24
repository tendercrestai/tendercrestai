"""Offline release-gate cases; never contacts Stripe."""
import importlib.util,pathlib,copy,unittest
spec=importlib.util.spec_from_file_location('trial_gate',pathlib.Path(__file__).resolve().parents[1]/'scripts/verify-stripe-trials.py');gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
class GateTests(unittest.TestCase):
 def setUp(self):
  self.links=[];self.items={}
  for name,(url,pid,amount) in gate.PLANS.items():
   lid='plink_'+name;self.links.append({'id':lid,'url':url,'active':True,'livemode':True,'subscription_data':{'trial_period_days':14},'payment_method_collection':'always'})
   self.items[lid]=[{'quantity':1,'price':{'id':pid,'currency':'usd','unit_amount':amount,'recurring':{'interval':'month','interval_count':1}}}]
 def check(self):return gate.verify(self.links,lambda link:self.items[link['id']])
 def test_all_three_match(self):self.assertTrue(all(row['ready'] for row in self.check()))
 def test_trial_card_and_live_settings_fail_closed(self):
  for field,value in [('active',False),('livemode',False),('payment_method_collection','if_required'),('subscription_data',{'trial_period_days':30})]:
   old=copy.deepcopy(self.links);self.links[0][field]=value;self.assertFalse(self.check()[0]['ready']);self.links=old
 def test_price_quantity_and_extra_items_fail_closed(self):
  old=copy.deepcopy(self.items);self.items['plink_Pro'][0]['quantity']=2;self.assertFalse(self.check()[0]['ready']);self.items=copy.deepcopy(old)
  self.items['plink_Pro'][0]['price']['unit_amount']=1;self.assertFalse(self.check()[0]['ready']);self.items=copy.deepcopy(old)
  self.items['plink_Pro'].append(copy.deepcopy(self.items['plink_Pro'][0]));self.assertFalse(self.check()[0]['ready'])
 def test_missing_or_duplicate_links_fail_closed(self):
  self.links.pop();self.assertFalse(self.check()[2]['ready']);self.links.append(copy.deepcopy(self.links[0]));self.assertFalse(self.check()[0]['ready'])
if __name__=='__main__':unittest.main()
