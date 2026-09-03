"""MotionArm MA-6 Python SDK — Vendor: Motion Robotics"""

class Arm:
    def move_joint(self, joint, radians, speed_rad_s):
        """Move one joint to an absolute angle."""

    def move_to(self, x, y, z, speed_mm_s):
        """Linear move of the tool center point."""

    def home(self):
        """Run the homing routine."""

    def stop(self):
        """Decelerate and stop all motion."""

    def get_pose(self):
        """Read the current tool pose."""

    def gripper_close(self, force_newtons):
        """Close the gripper with a force limit."""

    def set_payload(self, kg):
        """Declare the payload mass."""
