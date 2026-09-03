/* NexCore NX-32 firmware API */
void gpio_write(int pin, int value);
int gpio_read(int pin);
void i2c_write(int address, unsigned char* data, int length);
int i2c_read(int address, int length);
void pwm_configure(int pin, int frequency);
void pwm_write(int pin, int duty);
