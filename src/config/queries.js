const QUERIES = [
  {
    queryKey: "robota_ukraine_it_parttime",
    source: "robota",
    title: "Robota.ua - IT jobs in Ukraine (Віддалено, Українські компанії)",
    url: "https://robota.ua/zapros/ukraine/params;scheduleIds=3;rubrics=1",
  },
  {
    queryKey: "robota_other_countries_it_parttime",
    source: "robota",
    title: "Robota.ua - IT jobs in other countries (Віддалено, Іноземні компанії)",
    url: "https://robota.ua/zapros/other_countries/params;scheduleIds=3;rubrics=1",
  },
  {
    queryKey: "robota_vinnytsia_it",
    source: "robota",
    title: "Robota.ua - IT jobs in Vinnytsia (Вінниця)",
    url: "https://robota.ua/zapros/vinnytsia/params;rubrics=1",
  },
  {
    queryKey: "robota_ukraine_defense_parttime",
    source: "robota",
    title: "Robota.ua - Defense jobs in Ukraine (Віддалено)",
    url: "https://robota.ua/zapros/ukraine/params;scheduleIds=3;rubrics=1;branchIds=oboronna-promyslovist",
  },
  {
    queryKey: "robota_vinnytsia_defense",
    source: "robota",
    title: "Robota.ua - Defense jobs in Vinnytsia (Вінниця)",
    url: "https://robota.ua/zapros/vinnytsia/params;branchIds=oboronna-promyslovist",
  },
  {
    queryKey: "work_vinnytsia_defense",
    source: "work",
    title: "Work.ua - Defense jobs in Vinnytsia (Вінниця)",
    url: "https://www.work.ua/jobs-vinnytsya-industry-defense-industrial-complex/?days=123",
  },
  {
    queryKey: "work_remote_defense",
    source: "work",
    title: "Work.ua - Defense jobs remotely",
    url: "https://www.work.ua/jobs-remote-industry-defense-industrial-complex/?days=123",
  },
  {
    queryKey: "work_vinnytsia_it",
    source: "work",
    title: "Work.ua - IT jobs in Vinnytsia (Вінниця)",
    url: "https://www.work.ua/jobs-vinnytsya-it-industry-it/?days=123",
  },
  {
    queryKey: "work_remote_it",
    source: "work",
    title: "Work.ua - IT jobs remotely",
    url: "https://www.work.ua/jobs-remote-it-industry-it/?days=123",
  },
  {
    queryKey: "djinni_vinnytsia_miltech",
    source: "djinni",
    title: "Djinni - Miltech jobs in Vinnytsia (Вінниця)",
    url: "https://djinni.co/jobs/?search_type=basic-search&region=UKR&location=vinnytsia&editorial=miltech",
  },
  {
    queryKey: "djinni_remote_miltech",
    source: "djinni",
    title: "Djinni - Miltech jobs remotely",
    url: "https://djinni.co/jobs/?search_type=basic-search&employment=remote&editorial=miltech",
  },
  {
    queryKey: "djinni_vinnytsia_all",
    source: "djinni",
    title: "Djinni - All jobs in Vinnytsia (Вінниця)",
    url: "https://djinni.co/jobs/?search_type=basic-search&region=UKR&location=vinnytsia",
  },
  {
    queryKey: "djinni_remote_all",
    source: "djinni",
    title: "Djinni - All jobs remotely",
    url: "https://djinni.co/jobs/?search_type=basic-search&employment=remote",
  },
  {
    queryKey: "dou_vinnytsia",
    source: "dou_family",
    title: "DOU - All jobs in Vinnytsia (Вінниця)",
    family: "dou",
    url: "https://jobs.dou.ua/vacancies/?city=Vinnytsia",
  },
  {
    queryKey: "dou_remote",
    source: "dou_family",
    title: "DOU - All jobs remotely",
    family: "dou",
    url: "https://jobs.dou.ua/vacancies/?remote",
  },
  {
    queryKey: "deftech_vinnytsia",
    source: "dou_family",
    title: "DOU Family - Deftech jobs in Vinnytsia (Вінниця)",
    family: "deftech",
    url: "https://deftech.dou.ua/jobs/?city=%D0%92%D1%96%D0%BD%D0%BD%D0%B8%D1%86%D1%8F",
  },
  {
    queryKey: "deftech_remote",
    source: "dou_family",
    title: "DOU Family - Deftech jobs remotely",
    family: "deftech",
    url: "https://deftech.dou.ua/jobs/?remote",
  },
];

function getQueryByKey(queryKey) {
  return QUERIES.find((q) => q.queryKey === queryKey) || null;
}

module.exports = {
  QUERIES,
  getQueryByKey,
};
