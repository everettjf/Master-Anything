from calc import Calculator, average


def test_add():
    assert Calculator().add(2, 3) == 5


def test_sub():
    assert Calculator().sub(5, 2) == 3


def test_add_many():
    assert Calculator().add_many([1, 2, 3, 4]) == 10


def test_average():
    assert average([2, 4, 6]) == 4
    assert average([]) == 0
