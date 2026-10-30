# No upgrade advertising

The fork shows no upsell banners, cards, badges or upgrade modals, no License or Metabase Cloud pages, no store link,
and no "available on Pro/Enterprise" hints. Sections that only existed to sell a paid feature are gone (their routes
show "not found"). Metabase's product-feedback survey emails are off by default (`MB_SURVEYS_ENABLED=true` turns
them back on). A few paid-plan banners remain in the code but only appear with a Metabase license or on Metabase
Cloud, which this fork never has.
