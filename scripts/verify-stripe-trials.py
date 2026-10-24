#!/usr/bin/env python3
"""Read-only release gate. Requires STRIPE_READ_KEY; never creates a checkout or charge."""
import json,os,sys,urllib.request,urllib.error,urllib.parse
PLANS={
 'Pro':('https://buy.stripe.com/dRm9AT6PcaJT44U622dby00','price_1UJqs7FinOspVJZ4xHjda0xZ',29900),
 'Growth':('https://buy.stripe.com/eVqfZh4H44lv8laaiidby01','price_1UJquQFinOspVJZ4MQWPDG5c',69900),
 'Enterprise':('https://buy.stripe.com/14AdR92yW4lvcBq0HIdby02','price_1UJqwTFinOspVJZ4VPhpCVcG',129900)}
def read(path):
 req=urllib.request.Request('https://api.stripe.com/v1/'+path,headers={'Authorization':'Bearer '+os.environ['STRIPE_READ_KEY'],'Stripe-Version':'2026-08-26.dahlia','User-Agent':'TenderCrestTrialReadiness/1.0'})
 try:
  with urllib.request.urlopen(req,timeout=30) as response:return json.load(response)
 except urllib.error.HTTPError as error:raise RuntimeError('Stripe read denied: HTTP '+str(error.code)) from None
 except urllib.error.URLError:raise RuntimeError('Stripe network access unavailable; apply the environment domain configuration') from None
def verify(links,items_for,promotions_reviewed=False):
 results=[]
 for name,(url,price_id,amount) in PLANS.items():
  candidates=[link for link in links if link.get('url')==url]
  if len(candidates)!=1:results.append({'plan':name,'ready':False,'issues':['Expected exactly one existing payment link']});continue
  link=candidates[0];issues=[]
  if link.get('active') is not True or link.get('livemode') is not True:issues.append('Payment link must be active and live')
  if link.get('subscription_data',{}).get('trial_period_days')!=14:issues.append('Subscription trial must be exactly 14 days')
  if link.get('payment_method_collection')!='always':issues.append('Payment card collection must be required')
  if link.get('allow_promotion_codes') and not promotions_reviewed:issues.append('Promotion codes require separate review before promising the stated conversion price')
  items=items_for(link)
  if len(items)!=1:issues.append('Expected a single recurring plan and no extra/setup items')
  else:
   item=items[0];price=item.get('price',{});recurring=price.get('recurring',{})
   if item.get('quantity')!=1 or price.get('id')!=price_id or price.get('currency')!='usd' or price.get('unit_amount')!=amount or recurring.get('interval')!='month' or recurring.get('interval_count')!=1:issues.append('Price, currency, quantity or monthly interval differs from the reviewed plan')
   if item.get('adjustable_quantity',{}).get('enabled'):issues.append('Quantity must not be adjustable')
  results.append({'plan':name,'ready':not issues,'issues':issues})
 return results
def main():
 if not os.environ.get('STRIPE_READ_KEY'):raise RuntimeError('Configure STRIPE_READ_KEY securely; do not paste it in chat')
 links=[];after=None
 for _ in range(5):
  q=urllib.parse.urlencode({'limit':100,**({'starting_after':after} if after else {})});page=read('payment_links?'+q);links.extend(page.get('data',[]))
  if not page.get('has_more'):break
  if not page.get('data'):raise RuntimeError('Unexpected Stripe pagination')
  after=page['data'][-1]['id']
 else:raise RuntimeError('Payment link listing exceeded its bounded review limit')
 def items(link):
  page=read('payment_links/'+urllib.parse.quote(link['id'],safe='')+'/line_items?limit=10')
  if page.get('has_more'):return []
  return page.get('data',[])
 # Preserve an existing promotion-code entry box when there are no active
 # codes. Active promotions still require a deliberate price/terms review.
 relevant=[link for link in links if link.get('url') in [p[0] for p in PLANS.values()]]
 promotions_reviewed=False
 if any(link.get('allow_promotion_codes') for link in relevant):
  promotions=read('promotion_codes?active=true&limit=100')
  promotions_reviewed=promotions.get('data')==[] and promotions.get('has_more') is False
 results=verify(links,items,promotions_reviewed);print(json.dumps({'plans':results,'promotions_reviewed_no_active_codes':promotions_reviewed,'all_ready':all(row['ready'] for row in results)},indent=2));return 0 if all(row['ready'] for row in results) else 1
if __name__=='__main__':
 try:sys.exit(main())
 except (RuntimeError,KeyError,ValueError) as error:print(json.dumps({'all_ready':False,'error':str(error)}));sys.exit(1)
