import 'package:font_awesome_flutter/font_awesome_flutter.dart';

class SocialLink {
  const SocialLink(this.label, this.icon, this.url);
  final String label;
  final FaIconData icon;
  final String url;
}

/// ضع الروابط هنا فقط عند تجهيز الحسابات؛ السلسلة الفارغة تعطل الزر بأمان.
const socialLinks = <SocialLink>[
  SocialLink('واتساب', FontAwesomeIcons.whatsapp, ''),
  SocialLink('تليجرام', FontAwesomeIcons.telegram, ''),
  SocialLink('فيسبوك', FontAwesomeIcons.facebookF, ''),
  SocialLink('X', FontAwesomeIcons.xTwitter, ''),
  SocialLink('إنستغرام', FontAwesomeIcons.instagram, ''),
];
