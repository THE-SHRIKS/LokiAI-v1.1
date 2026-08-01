import 'package:flutter/material.dart';

class LokiBrand extends StatelessWidget {
  const LokiBrand({super.key, this.imageHeight = 28, this.showName = true});

  final double imageHeight;
  final bool showName;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Image.asset(
          'assets/lokiai-logo.png',
          height: imageHeight,
          width: imageHeight * 3.4,
          fit: BoxFit.cover,
          semanticLabel: 'LokiAI logo',
        ),
        if (showName) ...[
          const SizedBox(width: 8),
          const Text(
            'LokiAI',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w600,
              color: Color(0xFFF5F5F5),
              letterSpacing: -0.5,
            ),
          ),
        ],
      ],
    );
  }
}
