export interface DistrictGeo {
  name: string;
  lat: number;
  lng: number;
  zoom?: number;
}

export interface RegionGeo {
  code: string;
  cadastrePrefix: string;
  name: string;
  lat: number;
  lng: number;
  zoom: number;
  districts: DistrictGeo[];
}

export const UZBEKISTAN_CENTER: [number, number] = [41.3775, 64.5853];
export const UZBEKISTAN_DEFAULT_ZOOM = 6;

export const UZBEKISTAN_BOUNDS = {
  minLat: 37.15,
  maxLat: 45.65,
  minLng: 55.95,
  maxLng: 73.25,
};

export const UZBEKISTAN_REGIONS: RegionGeo[] = [
  {
    code: 'TOS',
    cadastrePrefix: '10',
    name: 'Toshkent shahri',
    lat: 41.3111,
    lng: 69.2797,
    zoom: 12,
    districts: [
      { name: 'Bektemir tumani', lat: 41.2286, lng: 69.3341, zoom: 15 },
      { name: 'Chilonzor tumani', lat: 41.2725, lng: 69.2044, zoom: 15 },
      { name: 'Mirobod tumani', lat: 41.2856, lng: 69.2869, zoom: 15 },
      { name: 'Mirzo Ulug‘bek tumani', lat: 41.3389, lng: 69.3345, zoom: 15 },
      { name: 'Olmazor tumani', lat: 41.3512, lng: 69.2221, zoom: 15 },
      { name: 'Sergeli tumani', lat: 41.2218, lng: 69.2225, zoom: 15 },
      { name: 'Shayxontohur tumani', lat: 41.3244, lng: 69.2435, zoom: 15 },
      { name: 'Uchtepa tumani', lat: 41.2895, lng: 69.1682, zoom: 15 },
      { name: 'Yakkasaroy tumani', lat: 41.2821, lng: 69.2547, zoom: 15 },
      { name: 'Yangihayot tumani', lat: 41.2015, lng: 69.2098, zoom: 15 },
      { name: 'Yashnobod tumani', lat: 41.2934, lng: 69.3422, zoom: 15 },
      { name: 'Yunusobod tumani', lat: 41.3653, lng: 69.2932, zoom: 15 },
    ],
  },
  {
    code: 'TVL',
    cadastrePrefix: '11',
    name: 'Toshkent viloyati',
    lat: 41.1167,
    lng: 69.45,
    zoom: 9,
    districts: [
      { name: 'Nurafshon shahri', lat: 41.0439, lng: 69.3567, zoom: 15 },
      { name: 'Angren shahri', lat: 41.0167, lng: 70.1436, zoom: 15 },
      { name: 'Bekobod shahri', lat: 40.2208, lng: 69.2697, zoom: 15 },
      { name: 'Chirchiq shahri', lat: 41.4689, lng: 69.5822, zoom: 15 },
      { name: 'Ohangaron shahri', lat: 40.9064, lng: 69.6383, zoom: 15 },
      { name: 'Olmaliq shahri', lat: 40.8447, lng: 69.5983, zoom: 15 },
      { name: 'Yangiyo‘l shahri', lat: 41.1147, lng: 69.0481, zoom: 15 },
      { name: 'Bekobod tumani', lat: 40.2442, lng: 69.1931, zoom: 14 },
      { name: 'Bo‘ka tumani', lat: 40.8119, lng: 69.1986, zoom: 14 },
      { name: 'Bo‘stonliq tumani', lat: 41.5842, lng: 69.7764, zoom: 14 },
      { name: 'Chinoz tumani', lat: 40.9375, lng: 68.7589, zoom: 14 },
      { name: 'Ohangaron tumani', lat: 40.9289, lng: 69.6789, zoom: 14 },
      { name: 'Oqqo‘rg‘on tumani', lat: 40.8861, lng: 69.0478, zoom: 14 },
      { name: 'O‘rta Chirchiq tumani', lat: 41.0692, lng: 69.3278, zoom: 14 },
      { name: 'Parkent tumani', lat: 41.2944, lng: 69.6764, zoom: 14 },
      { name: 'Piskent tumani', lat: 40.8969, lng: 69.3506, zoom: 14 },
      { name: 'Qibray tumani', lat: 41.3897, lng: 69.465, zoom: 14 },
      { name: 'Quyi Chirchiq tumani', lat: 40.9767, lng: 69.0936, zoom: 14 },
      { name: 'Toshkent tumani', lat: 41.4086, lng: 69.2597, zoom: 14 },
      { name: 'Yangiyo‘l tumani', lat: 41.1328, lng: 69.0825, zoom: 14 },
      { name: 'Yuqori Chirchiq tumani', lat: 41.3183, lng: 69.5106, zoom: 14 },
      { name: 'Zangiota tumani', lat: 41.2006, lng: 69.1528, zoom: 14 },
    ],
  },
  {
    code: 'SAM',
    cadastrePrefix: '18',
    name: 'Samarqand viloyati',
    lat: 39.6542,
    lng: 66.9597,
    zoom: 9,
    districts: [
      { name: 'Samarqand shahri', lat: 39.6542, lng: 66.9597, zoom: 15 },
      { name: 'Kattaqo‘rg‘on shahri', lat: 39.8989, lng: 66.2561, zoom: 15 },
      { name: 'Bulung‘ur tumani', lat: 39.7647, lng: 67.2714, zoom: 14 },
      { name: 'Ishtixon tumani', lat: 39.9664, lng: 66.4861, zoom: 14 },
      { name: 'Jomboy tumani', lat: 39.715, lng: 67.0933, zoom: 14 },
      { name: 'Kattaqo‘rg‘on tumani', lat: 39.8658, lng: 66.2983, zoom: 14 },
      { name: 'Narpay tumani', lat: 39.9367, lng: 65.9325, zoom: 14 },
      { name: 'Nurobod tumani', lat: 39.6081, lng: 66.2869, zoom: 14 },
      { name: 'Oqdaryo tumani', lat: 39.8686, lng: 66.7928, zoom: 14 },
      { name: 'Pastdarg‘om tumani', lat: 39.7136, lng: 66.6642, zoom: 14 },
      { name: 'Paxtachi tumani', lat: 39.9697, lng: 65.6258, zoom: 14 },
      { name: 'Payariq tumani', lat: 39.9914, lng: 66.8542, zoom: 14 },
      { name: 'Qo‘shrabot tumani', lat: 40.2656, lng: 66.6639, zoom: 14 },
      { name: 'Samarqand tumani', lat: 39.6056, lng: 66.9853, zoom: 14 },
      { name: 'Toyloq tumani', lat: 39.6014, lng: 67.0908, zoom: 14 },
      { name: 'Urgut tumani', lat: 39.4022, lng: 67.2431, zoom: 14 },
    ],
  },
  {
    code: 'FAR',
    cadastrePrefix: '15',
    name: 'Farg‘ona viloyati',
    lat: 40.3842,
    lng: 71.7843,
    zoom: 10,
    districts: [
      { name: 'Farg‘ona shahri', lat: 40.3842, lng: 71.7843, zoom: 15 },
      { name: 'Marg‘ilon shahri', lat: 40.4711, lng: 71.7247, zoom: 15 },
      { name: 'Qo‘qon shahri', lat: 40.5286, lng: 70.9425, zoom: 15 },
      { name: 'Quvasoy shahri', lat: 40.2972, lng: 71.9794, zoom: 15 },
      { name: 'Bag‘dod tumani', lat: 40.4658, lng: 71.2167, zoom: 14 },
      { name: 'Beshariq tumani', lat: 40.4358, lng: 70.6108, zoom: 14 },
      { name: 'Buvayda tumani', lat: 40.5625, lng: 71.1394, zoom: 14 },
      { name: 'Dang‘ara tumani', lat: 40.5831, lng: 70.9106, zoom: 14 },
      { name: 'Farg‘ona tumani', lat: 40.2286, lng: 71.7519, zoom: 14 },
      { name: 'Furqat tumani', lat: 40.4706, lng: 70.7719, zoom: 14 },
      { name: 'Oltiariq tumani', lat: 40.3919, lng: 71.4764, zoom: 14 },
      { name: 'O‘zbekiston tumani', lat: 40.3578, lng: 70.8286, zoom: 14 },
      { name: 'Qo‘shtepa tumani', lat: 40.5311, lng: 71.6089, zoom: 14 },
      { name: 'Quva tumani', lat: 40.5219, lng: 72.0728, zoom: 14 },
      { name: 'Rishton tumani', lat: 40.3567, lng: 71.2847, zoom: 14 },
      { name: 'So‘x tumani', lat: 39.9614, lng: 71.1356, zoom: 14 },
      { name: 'Toshloq tumani', lat: 40.4789, lng: 71.7678, zoom: 14 },
      { name: 'Uchko‘prik tumani', lat: 40.5436, lng: 71.0606, zoom: 14 },
      { name: 'Yozyovon tumani', lat: 40.6619, lng: 71.7436, zoom: 14 },
    ],
  },
  {
    code: 'AND',
    cadastrePrefix: '17',
    name: 'Andijon viloyati',
    lat: 40.7821,
    lng: 72.3442,
    zoom: 10,
    districts: [
      { name: 'Andijon shahri', lat: 40.7821, lng: 72.3442, zoom: 15 },
      { name: 'Xonobod shahri', lat: 40.8089, lng: 72.9922, zoom: 15 },
      { name: 'Andijon tumani', lat: 40.8169, lng: 72.3983, zoom: 14 },
      { name: 'Asaka tumani', lat: 40.6419, lng: 72.2386, zoom: 14 },
      { name: 'Baliqchi tumani', lat: 40.8994, lng: 71.8497, zoom: 14 },
      { name: 'Bo‘ston tumani', lat: 40.6869, lng: 71.9086, zoom: 14 },
      { name: 'Buloqboshi tumani', lat: 40.6292, lng: 72.5022, zoom: 14 },
      { name: 'Izboskan tumani', lat: 40.9286, lng: 72.2481, zoom: 14 },
      { name: 'Jalaquduq tumani', lat: 40.7228, lng: 72.6414, zoom: 14 },
      { name: 'Marhamat tumani', lat: 40.5025, lng: 72.3336, zoom: 14 },
      { name: 'Oltinko‘l tumani', lat: 40.8011, lng: 72.1728, zoom: 14 },
      { name: 'Paxtaobod tumani', lat: 40.9294, lng: 72.4969, zoom: 14 },
      { name: 'Qo‘rg‘ontepa tumani', lat: 40.7306, lng: 72.7617, zoom: 14 },
      { name: 'Shahrixon tumani', lat: 40.7133, lng: 72.0575, zoom: 14 },
      { name: 'Ulug‘nor tumani', lat: 40.7794, lng: 71.6967, zoom: 14 },
      { name: 'Xo‘jaobod tumani', lat: 40.6689, lng: 72.5619, zoom: 14 },
    ],
  },
  {
    code: 'NAM',
    cadastrePrefix: '16',
    name: 'Namangan viloyati',
    lat: 40.9983,
    lng: 71.6726,
    zoom: 10,
    districts: [
      { name: 'Namangan shahri', lat: 40.9983, lng: 71.6726, zoom: 15 },
      { name: 'Davlatobod tumani', lat: 41.0086, lng: 71.6083, zoom: 15 },
      { name: 'Yangi Namangan tumani', lat: 41.0314, lng: 71.6489, zoom: 15 },
      { name: 'Chortoq tumani', lat: 41.0692, lng: 71.8236, zoom: 14 },
      { name: 'Chust tumani', lat: 41.0036, lng: 71.2378, zoom: 14 },
      { name: 'Kosonsoy tumani', lat: 41.2503, lng: 71.5486, zoom: 14 },
      { name: 'Mingbuloq tumani', lat: 40.8617, lng: 71.4711, zoom: 14 },
      { name: 'Namangan tumani', lat: 40.9553, lng: 71.5914, zoom: 14 },
      { name: 'Norin tumani', lat: 40.9922, lng: 71.9708, zoom: 14 },
      { name: 'Pop tumani', lat: 40.8736, lng: 71.1089, zoom: 14 },
      { name: 'To‘raqo‘rg‘on tumani', lat: 41.0019, lng: 71.5117, zoom: 14 },
      { name: 'Uchqo‘rg‘on tumani', lat: 41.1136, lng: 72.0792, zoom: 14 },
      { name: 'Uychi tumani', lat: 41.0289, lng: 71.8428, zoom: 14 },
      { name: 'Yangiqo‘rg‘on tumani', lat: 41.1917, lng: 71.7239, zoom: 14 },
    ],
  },
  {
    code: 'BUX',
    cadastrePrefix: '20',
    name: 'Buxoro viloyati',
    lat: 39.7747,
    lng: 64.4286,
    zoom: 9,
    districts: [
      { name: 'Buxoro shahri', lat: 39.7747, lng: 64.4286, zoom: 15 },
      { name: 'Kogon shahri', lat: 39.7228, lng: 64.5517, zoom: 15 },
      { name: 'Buxoro tumani', lat: 39.8325, lng: 64.3981, zoom: 14 },
      { name: 'G‘ijduvon tumani', lat: 40.1003, lng: 64.6808, zoom: 14 },
      { name: 'Jondor tumani', lat: 39.7406, lng: 64.1783, zoom: 14 },
      { name: 'Kogon tumani', lat: 39.7089, lng: 64.5689, zoom: 14 },
      { name: 'Olot tumani', lat: 39.4161, lng: 63.8039, zoom: 14 },
      { name: 'Peshku tumani', lat: 40.0414, lng: 64.3975, zoom: 14 },
      { name: 'Qorako‘l tumani', lat: 39.5036, lng: 63.8489, zoom: 14 },
      { name: 'Qorovulbozor tumani', lat: 39.5019, lng: 64.7936, zoom: 14 },
      { name: 'Romitan tumani', lat: 39.9297, lng: 64.3794, zoom: 14 },
      { name: 'Shofirkon tumani', lat: 40.1194, lng: 64.5028, zoom: 14 },
      { name: 'Vobkent tumani', lat: 40.0206, lng: 64.5161, zoom: 14 },
    ],
  },
  {
    code: 'NAV',
    cadastrePrefix: '21',
    name: 'Navoiy viloyati',
    lat: 40.0844,
    lng: 65.3792,
    zoom: 8,
    districts: [
      { name: 'Navoiy shahri', lat: 40.0844, lng: 65.3792, zoom: 15 },
      { name: 'Zarafshon shahri', lat: 41.5761, lng: 64.205, zoom: 15 },
      { name: 'G‘ozg‘on shahri', lat: 40.4228, lng: 65.5022, zoom: 14 },
      { name: 'Karmana tumani', lat: 40.1419, lng: 65.3653, zoom: 14 },
      { name: 'Konimex tumani', lat: 40.2814, lng: 65.1508, zoom: 14 },
      { name: 'Navbahor tumani', lat: 40.2283, lng: 65.4519, zoom: 14 },
      { name: 'Nurota tumani', lat: 40.5614, lng: 65.6886, zoom: 14 },
      { name: 'Qiziltepa tumani', lat: 40.0331, lng: 64.85, zoom: 14 },
      { name: 'Tomdi tumani', lat: 41.7417, lng: 64.6214, zoom: 14 },
      { name: 'Uchquduq tumani', lat: 42.1567, lng: 63.5558, zoom: 14 },
      { name: 'Xatirchi tumani', lat: 40.0419, lng: 65.9614, zoom: 14 },
    ],
  },
  {
    code: 'QAS',
    cadastrePrefix: '19',
    name: 'Qashqadaryo viloyati',
    lat: 38.8606,
    lng: 65.7891,
    zoom: 9,
    districts: [
      { name: 'Qarshi shahri', lat: 38.8606, lng: 65.7891, zoom: 15 },
      { name: 'Shahrisabz shahri', lat: 39.0578, lng: 66.8342, zoom: 15 },
      { name: 'Chiroqchi tumani', lat: 39.0336, lng: 66.5739, zoom: 14 },
      { name: 'Dehqonobod tumani', lat: 38.3489, lng: 66.4847, zoom: 14 },
      { name: 'G‘uzor tumani', lat: 38.6208, lng: 66.2481, zoom: 14 },
      { name: 'Kasbi tumani', lat: 38.9472, lng: 65.4358, zoom: 14 },
      { name: 'Kitob tumani', lat: 39.1244, lng: 66.8831, zoom: 14 },
      { name: 'Ko‘kdala tumani', lat: 39.2456, lng: 66.1539, zoom: 14 },
      { name: 'Koson tumani', lat: 39.0378, lng: 65.585, zoom: 14 },
      { name: 'Mirishkor tumani', lat: 38.8594, lng: 65.2492, zoom: 14 },
      { name: 'Muborak tumani', lat: 39.2564, lng: 65.1536, zoom: 14 },
      { name: 'Nishon tumani', lat: 38.6347, lng: 65.6806, zoom: 14 },
      { name: 'Qamashi tumani', lat: 38.8206, lng: 66.4628, zoom: 14 },
      { name: 'Qarshi tumani', lat: 38.8264, lng: 65.7128, zoom: 14 },
      { name: 'Shahrisabz tumani', lat: 39.0319, lng: 66.8014, zoom: 14 },
      { name: 'Yakkabog‘ tumani', lat: 38.9767, lng: 66.6836, zoom: 14 },
    ],
  },
  {
    code: 'SUR',
    cadastrePrefix: '22',
    name: 'Surxondaryo viloyati',
    lat: 37.2242,
    lng: 67.2783,
    zoom: 9,
    districts: [
      { name: 'Termiz shahri', lat: 37.2242, lng: 67.2783, zoom: 15 },
      { name: 'Angor tumani', lat: 37.4589, lng: 67.1483, zoom: 14 },
      { name: 'Bandixon tumani', lat: 37.8686, lng: 67.3728, zoom: 14 },
      { name: 'Boysun tumani', lat: 38.2064, lng: 67.2006, zoom: 14 },
      { name: 'Denov tumani', lat: 38.2672, lng: 67.8989, zoom: 14 },
      { name: 'Jarqo‘rg‘on tumani', lat: 37.5069, lng: 67.4167, zoom: 14 },
      { name: 'Muzrabot tumani', lat: 37.3867, lng: 66.9681, zoom: 14 },
      { name: 'Oltinsoy tumani', lat: 38.1981, lng: 67.7689, zoom: 14 },
      { name: 'Qiziriq tumani', lat: 37.6194, lng: 67.2764, zoom: 14 },
      { name: 'Qumqo‘rg‘on tumani', lat: 37.8269, lng: 67.5961, zoom: 14 },
      { name: 'Sariosiyo tumani', lat: 38.4192, lng: 67.9478, zoom: 14 },
      { name: 'Sherobod tumani', lat: 37.6694, lng: 67.0086, zoom: 14 },
      { name: 'Sho‘rchi tumani', lat: 38.0061, lng: 67.7889, zoom: 14 },
      { name: 'Termiz tumani', lat: 37.2856, lng: 67.3492, zoom: 14 },
      { name: 'Uzun tumani', lat: 38.3747, lng: 68.0211, zoom: 14 },
    ],
  },
  {
    code: 'JIZ',
    cadastrePrefix: '13',
    name: 'Jizzax viloyati',
    lat: 40.1158,
    lng: 67.8422,
    zoom: 9,
    districts: [
      { name: 'Jizzax shahri', lat: 40.1158, lng: 67.8422, zoom: 15 },
      { name: 'Arnasoy tumani', lat: 40.4836, lng: 68.0819, zoom: 14 },
      { name: 'Baxmal tumani', lat: 39.7219, lng: 67.9894, zoom: 14 },
      { name: 'Do‘stlik tumani', lat: 40.5256, lng: 68.0347, zoom: 14 },
      { name: 'Forish tumani', lat: 40.3911, lng: 67.2342, zoom: 14 },
      { name: 'G‘allaorol tumani', lat: 40.0219, lng: 67.5975, zoom: 14 },
      { name: 'Mirzacho‘l tumani', lat: 40.5789, lng: 68.1986, zoom: 14 },
      { name: 'Paxtakor tumani', lat: 40.3153, lng: 67.9544, zoom: 14 },
      { name: 'Sharof Rashidov tumani', lat: 40.155, lng: 67.8011, zoom: 14 },
      { name: 'Yangiobod tumani', lat: 39.9278, lng: 68.8286, zoom: 14 },
      { name: 'Zafarobod tumani', lat: 40.3886, lng: 67.8264, zoom: 14 },
      { name: 'Zarbdor tumani', lat: 40.0889, lng: 68.1692, zoom: 14 },
      { name: 'Zomin tumani', lat: 39.9606, lng: 68.3958, zoom: 14 },
    ],
  },
  {
    code: 'SIR',
    cadastrePrefix: '12',
    name: 'Sirdaryo viloyati',
    lat: 40.4897,
    lng: 68.7842,
    zoom: 10,
    districts: [
      { name: 'Guliston shahri', lat: 40.4897, lng: 68.7842, zoom: 15 },
      { name: 'Shirin shahri', lat: 40.2194, lng: 69.1278, zoom: 15 },
      { name: 'Yangiyer shahri', lat: 40.275, lng: 68.8225, zoom: 15 },
      { name: 'Boyovut tumani', lat: 40.3592, lng: 68.8178, zoom: 14 },
      { name: 'Guliston tumani', lat: 40.4539, lng: 68.8431, zoom: 14 },
      { name: 'Mirzaobod tumani', lat: 40.4981, lng: 68.6656, zoom: 14 },
      { name: 'Oqoltin tumani', lat: 40.5389, lng: 68.4053, zoom: 14 },
      { name: 'Sardoba tumani', lat: 40.5425, lng: 68.4819, zoom: 14 },
      { name: 'Sayxunobod tumani', lat: 40.6639, lng: 68.8594, zoom: 14 },
      { name: 'Sirdaryo tumani', lat: 40.8436, lng: 68.6617, zoom: 14 },
      { name: 'Xovos tumani', lat: 40.2519, lng: 68.9383, zoom: 14 },
    ],
  },
  {
    code: 'XOR',
    cadastrePrefix: '22',
    name: 'Xorazm viloyati',
    lat: 41.55,
    lng: 60.6333,
    zoom: 10,
    districts: [
      { name: 'Urganch shahri', lat: 41.55, lng: 60.6333, zoom: 15 },
      { name: 'Xiva shahri', lat: 41.3783, lng: 60.3639, zoom: 15 },
      { name: 'Bog‘ot tumani', lat: 41.3547, lng: 60.8228, zoom: 14 },
      { name: 'Gurlan tumani', lat: 41.8447, lng: 60.3919, zoom: 14 },
      { name: 'Hazorasp tumani', lat: 41.3194, lng: 61.0742, zoom: 14 },
      { name: 'Qo‘shko‘pir tumani', lat: 41.5356, lng: 60.3478, zoom: 14 },
      { name: 'Shovot tumani', lat: 41.6558, lng: 60.3025, zoom: 14 },
      { name: 'Tuproqqal’a tumani', lat: 41.1986, lng: 61.3683, zoom: 14 },
      { name: 'Urganch tumani', lat: 41.5194, lng: 60.6714, zoom: 14 },
      { name: 'Xiva tumani', lat: 41.3519, lng: 60.3986, zoom: 14 },
      { name: 'Xonqa tumani', lat: 41.4744, lng: 60.7794, zoom: 14 },
      { name: 'Yangiariq tumani', lat: 41.3681, lng: 60.6083, zoom: 14 },
      { name: 'Yangibozor tumani', lat: 41.7119, lng: 60.5186, zoom: 14 },
    ],
  },
  {
    code: 'QOR',
    cadastrePrefix: '23',
    name: 'Qoraqalpog‘iston Respublikasi',
    lat: 42.4619,
    lng: 59.6166,
    zoom: 7,
    districts: [
      { name: 'Nukus shahri', lat: 42.4619, lng: 59.6166, zoom: 15 },
      { name: 'Amudaryo tumani', lat: 42.1167, lng: 60.0589, zoom: 14 },
      { name: 'Beruniy tumani', lat: 41.6911, lng: 60.7525, zoom: 14 },
      { name: 'Bo‘zatov tumani', lat: 42.9814, lng: 59.3542, zoom: 14 },
      { name: 'Chimboy tumani', lat: 42.9347, lng: 59.7789, zoom: 14 },
      { name: 'Ellikqal’a tumani', lat: 41.8489, lng: 60.9183, zoom: 14 },
      { name: 'Kegeyli tumani', lat: 42.7756, lng: 59.6086, zoom: 14 },
      { name: 'Mo‘ynoq tumani', lat: 43.7683, lng: 59.0214, zoom: 14 },
      { name: 'Nukus tumani', lat: 42.5486, lng: 59.5419, zoom: 14 },
      { name: 'Qanliko‘l tumani', lat: 42.8386, lng: 59.0064, zoom: 14 },
      { name: 'Qo‘ng‘irot tumani', lat: 43.0425, lng: 58.8503, zoom: 14 },
      { name: 'Qorao‘zak tumani', lat: 43.0278, lng: 60.0136, zoom: 14 },
      { name: 'Shumanay tumani', lat: 42.6419, lng: 58.9289, zoom: 14 },
      { name: 'Taxiatosh tumani', lat: 42.3314, lng: 59.5669, zoom: 14 },
      { name: 'Taxtako‘pir tumani', lat: 43.0225, lng: 60.2886, zoom: 14 },
      { name: 'To‘rtko‘l tumani', lat: 41.5522, lng: 61.0014, zoom: 14 },
      { name: 'Xo‘jayli tumani', lat: 42.4006, lng: 59.4494, zoom: 14 },
    ],
  },
];

const CYRILLIC_SEARCH_MAP: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  ғ: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'j',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  қ: 'q',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ў: 'o',
  ф: 'f',
  х: 'x',
  ҳ: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  ъ: '',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

/**
 * Normalizes Uzbek text (Latin or Cyrillic, with or without o'/g' apostrophes)
 * so typing e.g. "fargona", "farg'ona", "фарғона", "qoqon", "chilonzor" matches reliably.
 */
export function normalizeUzbekSearch(input: string): string {
  const lower = input.trim().toLowerCase();
  let transliterated = '';
  for (const ch of lower) {
    transliterated += ch in CYRILLIC_SEARCH_MAP ? CYRILLIC_SEARCH_MAP[ch] : ch;
  }
  return transliterated
    .replace(/['`´ʻʼ‘’"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getRegionCode(regionName: string): string {
  const target = normalizeUzbekSearch(regionName);
  const found = UZBEKISTAN_REGIONS.find(
    (r) =>
      normalizeUzbekSearch(r.name) === target ||
      normalizeUzbekSearch(r.name.replace(/ viloyati| respublikasi/i, '')) === target
  );
  return found ? found.code : 'UZB';
}

export function findNearestAdminArea(
  lat: number,
  lng: number
): { region: string; district: string; regionCode: string; cadastrePrefix: string } {
  let bestRegion = UZBEKISTAN_REGIONS[0];
  let bestDistrict = bestRegion.districts[0];
  let bestDistSq = Number.POSITIVE_INFINITY;

  for (const reg of UZBEKISTAN_REGIONS) {
    for (const dist of reg.districts) {
      const dLat = lat - dist.lat;
      const dLng = (lng - dist.lng) * Math.cos((lat * Math.PI) / 180);
      const distSq = dLat * dLat + dLng * dLng;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestRegion = reg;
        bestDistrict = dist;
      }
    }
  }

  return {
    region: bestRegion.name,
    district: bestDistrict.name,
    regionCode: bestRegion.code,
    cadastrePrefix: bestRegion.cadastrePrefix,
  };
}

export function getStatusLabel(status: 'has_cadastre' | 'no_cadastre' | 'unknown'): string {
  switch (status) {
    case 'has_cadastre':
      return 'Kadastr mavjud';
    case 'no_cadastre':
      return 'Kadastr mavjud emas';
    case 'unknown':
    default:
      return 'Holati noma’lum';
  }
}
