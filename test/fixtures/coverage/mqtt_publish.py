# buckets: nested import, try/except/finally, method call on an object, raise
import time

from umqtt.simple import MQTTClient

BROKER = "192.168.1.10"


def publish(topic, message):
    client = MQTTClient("pico", BROKER)
    try:
        client.connect()
        client.publish(topic, message)
    except OSError:
        raise
    finally:
        client.disconnect()


while True:
    publish(b"workshop/heartbeat", b"alive")
    time.sleep(30)
