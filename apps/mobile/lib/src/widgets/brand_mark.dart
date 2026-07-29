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
    final unit = size.shortestSide;
    final white = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = unit * .075
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    final path = Path()
      ..moveTo(unit * .23, unit * .69)
      ..lineTo(unit * .23, unit * .32)
      ..lineTo(unit * .5, unit * .58)
      ..lineTo(unit * .77, unit * .32)
      ..lineTo(unit * .77, unit * .69);
    canvas.drawPath(path, white);
    final node = Paint()..color = const Color(0xFFDDFBF6);
    for (final point in [
      Offset(unit * .23, unit * .31),
      Offset(unit * .5, unit * .58),
      Offset(unit * .77, unit * .31),
    ]) {
      canvas.drawCircle(point, unit * .075, node);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
