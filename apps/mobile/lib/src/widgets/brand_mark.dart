import 'package:flutter/material.dart';

class BrandMark extends StatelessWidget {
  const BrandMark({this.size = 56, this.showWordmark = false, super.key});
  final double size;
  final bool showWordmark;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            begin: Alignment.topRight,
            end: Alignment.bottomLeft,
            colors: [Color(0xFF36B7AA), Color(0xFF08756F)],
          ),
          borderRadius: BorderRadius.circular(size * .28),
          boxShadow: const [
            BoxShadow(color: Color(0x261A968C), blurRadius: 18, offset: Offset(0, 8)),
          ],
        ),
        child: CustomPaint(painter: _BrandPainter()),
      ),
      if (showWordmark) ...[
        const SizedBox(width: 10),
        Text(
          'معتز AI',
          style: Theme.of(context).textTheme.titleLarge?.copyWith(
            fontWeight: FontWeight.w900,
            color: const Color(0xFF10242A),
          ),
        ),
      ],
    ],
  );
}

class _BrandPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final white = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = size * .075
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    final path = Path()
      ..moveTo(size * .23, size * .69)
      ..lineTo(size * .23, size * .32)
      ..lineTo(size * .5, size * .58)
      ..lineTo(size * .77, size * .32)
      ..lineTo(size * .77, size * .69);
    canvas.drawPath(path, white);
    final node = Paint()..color = const Color(0xFFDDFBF6);
    for (final point in [
      Offset(size * .23, size * .31),
      Offset(size * .5, size * .58),
      Offset(size * .77, size * .31),
    ]) {
      canvas.drawCircle(point, size * .075, node);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
