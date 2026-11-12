// C++ sample for Treelights tests.
#include <iostream>
#include <vector>
#define MAX_PORTS 1024

namespace scan {
template <typename T>
class Report {
public:
    explicit Report(std::string host) : host_(std::move(host)) {}
    void add(const T& item) { items_.push_back(item); }
    [[nodiscard]] std::size_t size() const noexcept { return items_.size(); }
private:
    std::string host_;
    std::vector<T> items_;
};
}  // namespace scan

int main() {
    scan::Report<int> r{"10.0.0.1"};
    for (auto port : {22, 80, 443}) {
        if (port < MAX_PORTS) r.add(port);
    }
    std::cout << "open: " << r.size() << std::endl;
    return nullptr == nullptr ? 0 : 1;
}
