# RoboArm X1 SDK

Vendor: RoboLabs
Model: RoboArm X1

Robot manipulator with TCP control on port 5000.

## Motion API

```python
def moveTo(x, y, z):
    """Move end effector to position."""

def home():
    """Home all axes."""

def stop():
    """Emergency stop."""
```

## Gripper

```python
def gripper_open():
def gripper_close():
```

## Status

Call `status()` for device health.
