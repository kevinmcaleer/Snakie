def flash_on_fault(faults, led):
    for fault in faults:
        if fault.active:
            led.toggle()
