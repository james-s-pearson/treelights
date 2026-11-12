// Java sample for Treelights tests.
package example.scan;

import java.util.List;
import java.util.stream.Collectors;

public final class Sample {
    private static final int MAX_PORTS = 1024;
    private final String host;

    public Sample(String host) { this.host = host; }

    @Override
    public String toString() { return "Sample[" + host + "]"; }

    public List<Integer> open(List<Integer> ports) {
        return ports.stream()
            .filter(p -> p > 0 && p < MAX_PORTS)
            .collect(Collectors.toList());
    }

    public static void main(String[] args) throws Exception {
        var s = new Sample(args.length > 0 ? args[0] : "10.0.0.1");
        System.out.println(s.open(List.of(22, 80, 8080)) + " " + true + null);
    }
}
